const {getInput, setFailed, setOutput} = require('@actions/core');
const {getOctokit, context} = require('@actions/github');
const parser = require('conventional-commits-parser')


const scopeCustomLabelType = 'scope_custom_labels';
const typeCustomLabelType = 'custom_labels';

function getScopeCustomLabels() {
    let customLabelKeys = []
    const customLabelsInput = JSON.parse(getInput(scopeCustomLabelType));
    if (customLabelsInput !== undefined) {
        customLabelKeys = Object.keys(customLabelsInput);
    }
    return customLabelKeys;
}

/**
 * Main function to run the whole process.
 */
async function run() {
    const commitDetail = await checkConventionalCommits();
    await checkTicketNumber(commitDetail);
    const pr = context.payload.pull_request;
    console.log("log from console")
    setOutput("log from output")
    await applyTaskTypeLabel(pr, commitDetail, commitDetail.type, typeCustomLabelType, commitDetail.breaking, JSON.parse(getInput('task_types')));
    const addLabel = getInput('add_scope_label');
    console.log('adding labels for scope' + addLabel)
    setOutput("log from output add lable  " + addLabel )
    await applyScopeLabel(pr, commitDetail, commitDetail.scope);
}


function extractConventionalCommitData(title) {
    const titleAst = parser.sync(title.trimStart(), {
        headerPattern: /^(\w*)(?:\(([\w$.\-/ ])\))?!?: (.*)$/,
        breakingHeaderPattern: /^(\w*)(?:\(([\w$.\-/ ])\))?!: (.*)$/
    });
    const cc = {
        type: titleAst.type ? titleAst.type : '',
        scope: titleAst.scope ? titleAst.scope : '',
        breaking: titleAst.notes && titleAst.notes.some(note => note.title === 'BREAKING CHANGE'),
    };
    return cc;
}

/**
 * Check the conventional commits of the task.
 * Parse the title of the pull request and validate against the task type list.
 * @returns {Promise<Object>} An object with details of the commit: type, scope and whether it's a breaking change.
 */
async function checkConventionalCommits() {
    let taskTypesInput = getInput('task_types');
    if (!taskTypesInput) {
        setFailed('Missing required input: task_types');
        return;
    }
    let taskTypeList;
    try {
        taskTypeList = JSON.parse(taskTypesInput);
    } catch (err) {
        setFailed('Invalid task_types input. Expecting a JSON array.');
        return;
    }
    const pr = context.payload.pull_request;
    const cc = extractConventionalCommitData(pr.title);
    if (!cc.type || !taskTypeList.includes(cc.type)) {
        setFailed(`Invalid or missing task type: '${cc.type}'. Must be one of: ${taskTypeList.join(', ')}`);
        return;
    }
    return cc;
}

/**
 * Check the ticket number based on the PR title and a provided regex.
 */
async function checkTicketNumber() {
    const ticketKeyRegex = getInput('ticket_key_regex');
    if (ticketKeyRegex) {
        const pr = context.payload.pull_request;
        const taskNumberMatch = pr.title.match(new RegExp(ticketKeyRegex));
        const taskNumber = taskNumberMatch ? taskNumberMatch[0] : '';
        if (!taskNumber) {
            setFailed(`Invalid or missing task number: '${taskNumber}'. Must match: ${ticketKeyRegex}`);
        }
    }
}

/**
 * Apply labels to the pull request based on the details of the commit and any custom labels provided.
 * @param {Object} pr The pull request object.
 * @param {Object} commitDetail The object with details of the commit.
 * @param labelName
 * @param labelType
 * @param breaking
 */
async function applyTaskTypeLabel(pr, commitDetail, labelName, labelType, breaking, taskTypesDefinedInInput) {
    const addLabel = getInput('add_label');
    if (addLabel !== undefined && addLabel.toLowerCase() === 'false') {
        return;
    }
    if (labelName === undefined) {
        return;
    }
    const customLabelsInput = getInput(labelType);
    let customLabels = {};
    if (customLabelsInput) {
        try {
            customLabels = JSON.parse(customLabelsInput);
            // Validate that customLabels is an object and all its keys and values are strings
            if (typeof customLabels !== 'object' || Array.isArray(customLabels) || Object.entries(customLabels).some(([k, v]) => typeof k !== 'string' || typeof v !== 'string')) {
                setFailed('Invalid custom_labels input. Expecting a JSON object with string keys and values.');
                return;
            }
        } catch (err) {
            setFailed('Invalid custom_labels input. Unable to parse JSON.');
            return;
        }
    }
    await updateLabels(pr, commitDetail, customLabels, labelName, breaking, taskTypesDefinedInInput, labelType);
}

async function getPreviousTitle(pr) {
    try {
        const octokit = getOctokit(getInput('token'));
        const prNumber = github.context.payload.pull_request.number;
        const owner = github.context.repo.owner;
        const repo = github.context.repo.repo;

        // Fetch PR events to check for title changes
        const {data: events} = await octokit.rest.issues.listEventsForTimeline({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: prnumber,
        });

        // Find the most recent title change event before the current one
        const previousTitleEvent = events
            .filter(event => event.event === 'edited' && event.changes && event.changes.title)
            .pop();

        if (previousTitleEvent) {
            return previousTitleEvent.changes.title.from
        } else {
            console.log('No previous title found.');
            core.setOutput('no previous_title', null);
        }

    } catch (error) {
    }
}

async function applyScopeLabel(pr, scopeName) {
    const addLabelEnabled = getInput('add_scope_label');
    if (addLabelEnabled !== undefined && addLabelEnabled.toLowerCase() === 'false' || scopeName === undefined) {
        return;
    }

    const octokit = getOctokit(getInput('token'));
    const currentLabelsResult = await getCurrentLabelsResult(octokit, pr);
    const prevTitle = getPreviousTitle(pr)

    cc = extractConventionalCommitData(prevTitle)
    if (cc.scope == scopeName) {
        return;
    }
    removeLabel(octokit, pr, cc.scope)
    prefix = getInput('scope_label_prefix')
    createOrAddLabel(octokit, prefix + scopeName, pr)
}

async function getCurrentLabelsResult(octokit, pr) {
    return await octokit.rest.issues.listLabelsOnIssue({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: pr.number
    });
}

async function removeLabel(octokit, pr, label) {
    await octokit.rest.issues.removeLabel({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: pr.number,
        name: label
    });
}

async function createLabel(octokit, label, color) {
    await octokit.rest.issues.createLabel({
        owner: context.repo.owner,
        repo: context.repo.repo,
        name: label,
        color: color
    });
}

async function createOrAddLabel(octokit, label, pr) {
    try {
        await octokit.rest.issues.getLabel({
            owner: context.repo.owner,
            repo: context.repo.repo,
            name: label
        });
    } catch (err) {
        // Label does not exist, create it
        let color = generateColor(label);
        await createLabel(octokit, label, color);
    }
    await octokit.rest.issues.addLabels({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: pr.number,
        labels: [label],
    });
}

/**
 * Update labels on the pull request.
 */
async function updateLabels(pr, commitDetail, customLabels, labelName, breaking, expectedTaskTypes, labelType) {
    const octokit = getOctokit(getInput('token'));
    const currentLabelsResult = await getCurrentLabelsResult(octokit, pr);
    const currentLabels = currentLabelsResult.data.map(label => label.name);
    const managedLabels = expectedTaskTypes.concat(['breaking change']);
    // Include customLabels keys in managedLabels, if any
    Object.values(customLabels).forEach(label => {
        if (!managedLabels.includes(label)) {
            managedLabels.push(label);
        }
    });
    let newLabels = [customLabels[labelName] ? customLabels[labelName] : labelName];
    const breakingChangeLabel = 'breaking change';
    if (breaking && !newLabels.includes(breakingChangeLabel)) {
        newLabels.push(breakingChangeLabel);
    }
    // Determine labels to remove and remove them
    if (labelType === scopeCustomLabelType) {
        const labelsToRemove = currentLabels.filter(label => managedLabels.includes(label) && !newLabels.includes(label));
        for (let label of labelsToRemove) {
            await removeLabel(octokit, pr, label);
        }
    }
    // Ensure new labels exist with the desired color and add them
    for (let label of newLabels) {
        if (!currentLabels.includes(label)) {
            await createOrAddLabel(octokit, label, pr);
        }
    }
}

/**
 * Generates a color based on the string input.
 */
function generateColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }

    let color = '';
    for (let i = 0; i < 3; i++) {
        let value = (hash >> (i * 8)) & 0xFF;
        color += ('00' + value.toString(16)).substr(-2);
    }

    return color;
}

run().catch(err => setFailed(err.message));

module.exports = {
    run,
    checkConventionalCommits,
    checkTicketNumber,
    applyLabel,
    updateLabels,
    generateColor
};
