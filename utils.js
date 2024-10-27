const { getInput, setFailed } = require('@actions/core');
const { getOctokit, context } = require('@actions/github');

const githubApi = {
    async getCurrentLabelsResult(octokit, pr) {
        return await octokit.rest.issues.listLabelsOnIssue({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: pr.number
        });
    },

    async removeLabel(octokit, pr, label) {
        await octokit.rest.issues.removeLabel({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: pr.number,
            name: label
        });
    },

    async createLabel(octokit, label, color) {
        await octokit.rest.issues.createLabel({
            owner: context.repo.owner,
            repo: context.repo.repo,
            name: label,
            color: color
        });
    },

    async createOrAddLabel(octokit, label, pr) {
        try {
            await octokit.rest.issues.getLabel({
                owner: context.repo.owner,
                repo: context.repo.repo,
                name: label
            });
        } catch (err) {
            let color = generateColor(label);
            await this.createLabel(octokit, label, color);
        }
        await octokit.rest.issues.addLabels({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: pr.number,
            labels: [label]
        });
    },

    async getCurrentLabels(octokit, pr) {
        return await octokit.rest.issues.listLabelsOnIssue({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: pr.number
        });
    }
};

module.exports = githubApi;
