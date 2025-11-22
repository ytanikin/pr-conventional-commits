const { getInput, setFailed } = require('@actions/core');
const { getOctokit, context } = require('@actions/github');
const parser = require('conventional-commits-parser')
const yaml = require('js-yaml');
const githubApi = require('./githubapi');

/**
 * Main function to run the whole process.
 */
async function run() {
    const commitDetail = await checkConventionalCommits();
    await checkScope(commitDetail);
    await checkTicketNumber(commitDetail);

    // Only apply labels if commitDetail is valid
    if (commitDetail) {
        const pr = context.payload.pull_request;
        await applyLabel(pr, commitDetail);
        await applyScopeLabel(pr, commitDetail);
    }
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
        const failOnNonConventional = getInput('fail_on_non_conventional');
        const errorMessage = `Invalid or missing task type: '${cc.type}'. Must be one of: ${taskTypeList.join(', ')}`;

        if (failOnNonConventional !== undefined && failOnNonConventional.toLowerCase() === 'false') {
            console.log(`Warning: ${errorMessage}`);
            return null;
        }

        setFailed(errorMessage);
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
 * Check the scope on the PR title.
 */
async function checkScope(commitDetail) {
    if (!commitDetail) {
        return;
    }

    const scopeTypes = getScopeTypes();
    if (scopeTypes === null) {
        return;
    }

    if (!scopeTypes.includes(commitDetail.scope)) {
        const failOnNonConventional = getInput('fail_on_non_conventional');
        const errorMessage = `Invalid or missing scope: '${commitDetail.scope}'. Must be one of: ${scopeTypes.join(', ')}`;

        if (failOnNonConventional !== undefined && failOnNonConventional.toLowerCase() === 'false') {
            console.log(`Warning: ${errorMessage}`);
            return;
        }

        setFailed(errorMessage);
    }
}

function getScopeTypes() {
    const scopeTypesInput = getInput('scope_types');
    if (!scopeTypesInput) {
        return null;
    }

    try {
        const scopeTypeList = JSON.parse(scopeTypesInput);
        if (!Array.isArray(scopeTypeList)) {
            throw new Error('Invalid format'); // Ensure the parsed result is an array
        }
        return scopeTypeList;
    } catch (err) {
        setFailed('Invalid scope_types input. Expecting a JSON array.');
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
            const failOnNonConventional = getInput('fail_on_non_conventional');
            const errorMessage = `Invalid or missing task number: '${taskNumber}'. Must match: ${ticketKeyRegex}`;

            if (failOnNonConventional !== undefined && failOnNonConventional.toLowerCase() === 'false') {
                console.log(`Warning: ${errorMessage}`);
                return;
            }

            setFailed(errorMessage);
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
    const labelMapInput = getInput('label_map');

    // Check for mutual exclusivity
    if (customLabelsInput && labelMapInput) {
        setFailed('Cannot use both custom_labels and label_map. Please use only one.');
        return;
    }

    let labelMapping;
    if (labelMapInput) {
        labelMapping = parseLabelMap(labelMapInput);
    } else {
        labelMapping = parseCustomLabels(customLabelsInput);
    }

    if (labelMapping === null) {
        return;
    }
    await updateLabels(pr, commitDetail, labelMapping);
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

function parseLabelMap(labelMapInput) {
    if (!labelMapInput) {
        return {};
    }

    try {
        const labelMap = yaml.load(labelMapInput);
        // Validate that labelMap is an object with string keys and values
        if (typeof labelMap !== 'object' || Array.isArray(labelMap) || labelMap === null ||
            Object.entries(labelMap).some(([k, v]) => typeof k !== 'string' || typeof v !== 'string')) {
            setFailed('Invalid label_map input. Expecting a YAML object with string keys and values.');
            return null;
        }
        return labelMap;
    } catch (err) {
        setFailed('Invalid label_map input. Unable to parse YAML.');
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

function parseScopeLabelMap(scopeLabelMapInput) {
    if (!scopeLabelMapInput) {
        return {};
    }

    try {
        const scopeLabelMap = yaml.load(scopeLabelMapInput);
        // Validate that scopeLabelMap is an object with string keys and values
        if (typeof scopeLabelMap !== 'object' || Array.isArray(scopeLabelMap) || scopeLabelMap === null ||
            Object.entries(scopeLabelMap).some(([k, v]) => typeof k !== 'string' || typeof v !== 'string')) {
            setFailed('Invalid add_scope_label_map input. Expecting a YAML object with string keys and values.');
            return null;
        }
        return scopeLabelMap;
    } catch (err) {
        setFailed('Invalid add_scope_label_map input. Unable to parse YAML.');
        return null;
    }
}

async function applyScopeLabel(pr, commitDetail) {
    const addLabelEnabled = getInput('add_scope_label');
    const scopeName = commitDetail.scope;
    if (addLabelEnabled !== undefined && addLabelEnabled.toLowerCase() === 'false' || scopeName === undefined || scopeName === "") {
        return;
    }

    // Parse scope label map
    const scopeLabelMapInput = getInput('add_scope_label_map');
    const scopeLabelMap = parseScopeLabelMap(scopeLabelMapInput);
    if (scopeLabelMap === null) {
        return;
    }

    // Determine the label to apply (mapped or original scope)
    const labelToApply = scopeLabelMap[scopeName] !== undefined ? scopeLabelMap[scopeName] : scopeName;

    const octokit = getOctokit(getInput('token'));
    const currentLabelsResult = await githubApi.getCurrentLabelsResult(octokit, pr);
    const currentLabels = currentLabelsResult.data.map(label => label.name);
    if (currentLabels.includes(labelToApply)) {
        return;
    }

    // Check if we should only use existing labels
    const onlyExisting = getInput('add_scope_label_only_existing');
    if (onlyExisting !== undefined && onlyExisting.toLowerCase() === 'true') {
        await githubApi.addLabelIfExists(octokit, labelToApply, pr);
    } else {
        await githubApi.createOrAddLabel(octokit, labelToApply, pr);
    }
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
    checkScope,
    checkTicketNumber,
    applyLabel,
    updateLabels,
    applyScopeLabel,
    parseScopeLabelMap,
    parseLabelMap
};
