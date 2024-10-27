const { getInput, setFailed } = require('@actions/core');
const { getOctokit, context } = require('@actions/github');
const utils = require('./utils');

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
        let color = utils.generateColor(label);
        await createLabel(octokit, label, color);
    }
    await octokit.rest.issues.addLabels({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: pr.number,
        labels: [label],
    });
}

async function getCurrentLabels(octokit, pr) {
    const currentLabelsResult = await octokit.rest.issues.listLabelsOnIssue({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: pr.number
    });
    return currentLabelsResult;
}

module.exports = {
    getCurrentLabelsResult,
    removeLabel,
    createLabel,
    createOrAddLabel,
    getCurrentLabels
};
