const { getInput, setFailed } = require('@actions/core');
const { getOctokit, context } = require('@actions/github');
const parser = require('conventional-commits-parser')
const githubApi = require('./githubapi');

/**
 * Main function to run the whole process.
 */
async function run() {
    const commitDetail = await checkConventionalCommits();
    await checkTicketNumber(commitDetail);
    const pr = context.payload.pull_request;
    await applyLabel(pr, commitDetail);
    await applyScopeLabel(pr, commitDetail)
}

function parseConventionalCommit(pr) {
    const titleAst = parser.sync(pr.title.trimStart(), {
        headerPattern: /^(\w*)(?:\((.*?)\))?!?: (.*)$/,
        breakingHeaderPattern: /^(\w*)(?:\((.*?)\))?!: (.*)$/
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
    const taskTypeList = getTaskTypes();
    if (taskTypeList === null) {
        return;
    }

    const pr = context.payload.pull_request;
    const cc = parseConventionalCommit(pr);
    if (!cc.type || !taskTypeList.includes(cc.type)) {
        setFailed(`Invalid or missing task type: '${cc.type}'. Must be one of: ${taskTypeList.join(', ')}`);
        return;
    }
    return cc;
}

function getTaskTypes() {
    const taskTypesInput = getInput('task_types');
    if (!taskTypesInput) {
        setFailed('Missing required input: task_types');
        return null;
    }

    try {
        const taskTypeList = JSON.parse(taskTypesInput);
        if (!Array.isArray(taskTypeList)) {
            throw new Error('Invalid format'); // Ensure the parsed result is an array
        }
        return taskTypeList;
    } catch (err) {
        setFailed('Invalid task_types input. Expecting a JSON array.');
        return null;
    }
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
 */
async function applyLabel(pr, commitDetail) {
    const addLabel = getInput('add_label');
    if (addLabel !== undefined && addLabel.toLowerCase() === 'false') {
        return;
    }

    const customLabelsInput = getInput('custom_labels');
    const customLabels = parseCustomLabels(customLabelsInput);
    if (customLabels === null) {
        return;
    }
    await updateLabels(pr, commitDetail, customLabels);
}

function parseCustomLabels(customLabelsInput) {
    if (!customLabelsInput) {
        return {};
    }

    try {
        const customLabels = JSON.parse(customLabelsInput);
        // Validate that customLabels is an object and all its keys and values are strings
        if (typeof customLabels !== 'object' || Array.isArray(customLabels) ||
            Object.entries(customLabels).some(([k, v]) => typeof k !== 'string' || typeof v !== 'string')) {
            setFailed('Invalid custom_labels input. Expecting a JSON object with string keys and values.');
            return null;
        }
        return customLabels;
    } catch (err) {
        setFailed('Invalid custom_labels input. Unable to parse JSON.');
        return null;
    }
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

async function applyScopeLabel(pr, commitDetail) {
    const addLabelEnabled = getInput('add_scope_label');
    scopeName = commitDetail.scope;
    if (addLabelEnabled !== undefined && addLabelEnabled.toLowerCase() === 'false' || scopeName === undefined || scopeName === "") {
        return;
    }
    console.log("scope name " + scopeName)

    prefix = getInput('scope_label_prefix')
    const octokit = getOctokit(getInput('token'));
    const currentLabelsResult = await githubApi.getCurrentLabelsResult(octokit, pr);
    const currentLabels = currentLabelsResult.data.map(label => label.name);
    const newLabel = prefix + scopeName;
    if (currentLabels.includes(newLabel)) {
        return;
    }
    githubApi.createOrAddLabel(octokit, newLabel, pr)
}

/**
 * Update labels on the pull request.
 */
async function updateLabels(pr, cc, customLabels) {
    const token = getInput('token');
    const octokit = getOctokit(token);
    const currentLabelsResult = await githubApi.getCurrentLabels(octokit, pr);
    const currentLabels = currentLabelsResult.data.map(label => label.name);
    let taskTypesInput = getInput('task_types');
    let taskTypeList = JSON.parse(taskTypesInput);
    const managedLabels = taskTypeList.concat(['breaking change']);
    // Include customLabels keys in managedLabels, if any
    Object.values(customLabels).forEach(label => {
        if (!managedLabels.includes(label)) {
            managedLabels.push(label);
        }
    });
    let newLabels = [customLabels[cc.type] ? customLabels[cc.type] : cc.type];
    const breakingChangeLabel = 'breaking change';
    if (cc.breaking && !newLabels.includes(breakingChangeLabel)) {
        newLabels.push(breakingChangeLabel);
    }
    // Determine labels to remove and remove them
    const labelsToRemove = currentLabels.filter(label => managedLabels.includes(label) && !newLabels.includes(label));
    for (let label of labelsToRemove) {
        await githubApi.removeLabel(octokit, pr, label)
    }
    // Ensure new labels exist with the desired color and add them
    for (let label of newLabels) {
        if (!currentLabels.includes(label)) {
            await githubApi.createOrAddLabel(octokit, label, pr)
        }
    }
}


run().catch(err => setFailed(err.message));

module.exports = {
    run,
    checkConventionalCommits,
    checkTicketNumber,
    applyLabel,
    updateLabels
};
