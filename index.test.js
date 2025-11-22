const { getInput, setFailed } = require("@actions/core");
const { getOctokit, context } = require("@actions/github");
const toConventionalChangelogFormat = require("conventional-commits-parser");

jest.mock("@actions/core");
jest.mock("@actions/github");

const myModule = require("./index");
const utils = require("./utils");

beforeEach(() => {
  jest.resetAllMocks();
});
let logMock;
beforeEach(() => {
  logMock = jest.spyOn(console, "log");
  logMock.mockImplementation(() => {});
});

afterEach(() => {
  logMock.mockRestore();
});

describe("checkConventionalCommits", () => {
  it("should succeed when a valid task type is provided", async () => {
    getInput.mockReturnValue(JSON.stringify(["feat", "fix"]));
    context.payload = {
      pull_request: { title: "feat(login): add new login feature" },
    };

    const commitDetail = await myModule.checkConventionalCommits();

    expect(setFailed).not.toHaveBeenCalled();
    expect(commitDetail).toEqual({
      type: "feat",
      scope: "login",
      breaking: false,
    });
  });

  it("should succeed when a valid task type is provided and breaking change", async () => {
    getInput.mockReturnValue(JSON.stringify(["feat", "fix"]));
    context.payload = {
      pull_request: { title: "feat(login)!: add new login feature" },
    };

    const commitDetail = await myModule.checkConventionalCommits();

    expect(setFailed).not.toHaveBeenCalled();
    expect(commitDetail).toEqual({
      type: "feat",
      scope: "login",
      breaking: true,
    });
  });

  it("should fail when task_types input is missing", async () => {
    getInput.mockReturnValue("");
    await myModule.checkConventionalCommits();
    expect(setFailed).toHaveBeenCalledWith(
      "Missing required input: task_types"
    );
  });

  it("should fail when task_types input is invalid JSON", async () => {
    getInput.mockReturnValue("invalid JSON");
    await myModule.checkConventionalCommits();
    expect(setFailed).toHaveBeenCalledWith(
      "Invalid task_types input. Expecting a JSON array."
    );
  });

  it("should fail when task type is invalid and fail_on_non_conventional is true", async () => {
    getInput.mockImplementation((inputName) => {
      if (inputName === "task_types") {
        return JSON.stringify(["feat", "fix"]);
      }
      if (inputName === "fail_on_non_conventional") {
        return "true";
      }
      return undefined;
    });
    context.payload = {
      pull_request: { title: "invalid(login): add new login feature" },
    };

    const commitDetail = await myModule.checkConventionalCommits();

    expect(setFailed).toHaveBeenCalledWith(
      "Invalid or missing task type: 'invalid'. Must be one of: feat, fix"
    );
    expect(commitDetail).toBeUndefined();
  });

  it("should not fail when task type is invalid and fail_on_non_conventional is false", async () => {
    getInput.mockImplementation((inputName) => {
      if (inputName === "task_types") {
        return JSON.stringify(["feat", "fix"]);
      }
      if (inputName === "fail_on_non_conventional") {
        return "false";
      }
      return undefined;
    });
    context.payload = {
      pull_request: { title: "invalid(login): add new login feature" },
    };

    const commitDetail = await myModule.checkConventionalCommits();

    expect(setFailed).not.toHaveBeenCalled();
    expect(commitDetail).toBeNull();
  });
});

describe("checkTicketNumber", () => {
  it("should fail when ticket number is missing or invalid", async () => {
    getInput.mockReturnValue("\\d+");
    context.payload = {
      pull_request: { title: "no number here" },
    };
    await myModule.checkTicketNumber();
    expect(setFailed).toHaveBeenCalledWith(
      "Invalid or missing task number: ''. Must match: \\d+"
    );
  });

  it("should not fail when ticket number is invalid and fail_on_non_conventional is false", async () => {
    getInput.mockImplementation((inputName) => {
      if (inputName === "ticket_key_regex") {
        return "\\d+";
      }
      if (inputName === "fail_on_non_conventional") {
        return "false";
      }
      return undefined;
    });
    context.payload = {
      pull_request: { title: "no number here" },
    };
    await myModule.checkTicketNumber();
    expect(setFailed).not.toHaveBeenCalled();
  });
});

describe("applyLabel", () => {
  beforeEach(() => {
    // Mock the context.repo object to provide owner and repo values
    context.repo = {
      owner: "mockOwner",
      repo: "mockRepo",
    };
  });

  it("should skip label addition if add_label is set to false", async () => {
    getInput.mockReturnValue("false");
    await myModule.applyLabel({}, {});
    expect(setFailed).not.toHaveBeenCalled();
  });

  it("should fail if custom_labels input is invalid JSON", async () => {
    getInput.mockReturnValueOnce("true").mockReturnValueOnce("invalid JSON");
    await myModule.applyLabel({}, {});
    expect(setFailed).toHaveBeenCalledWith(
      "Invalid custom_labels input. Unable to parse JSON."
    );
  });

  it("should remove existing labels that are in the managed list but not in the new labels", async () => {
    const mockOctokit = {
      rest: {
        issues: {
          listLabelsOnIssue: jest.fn().mockResolvedValue({
            data: [
              { name: "feat" },
              { name: "fix" },
              { name: "breaking change" },
            ],
          }),
          removeLabel: jest.fn().mockResolvedValue({}),
          addLabels: jest.fn().mockResolvedValue({}),
        },
      },
    };
    getInput.mockImplementation((inputName) => {
      if (inputName === "task_types") {
        return JSON.stringify(["feat", "fix"]);
      }
      if (inputName === "token") {
        return "token";
      }
      return undefined;
    });

    getOctokit.mockReturnValue(mockOctokit);
    const pr = {
      number: 123,
    };
    const commitDetail = {
      type: "fix",
      breaking: false,
    };
    const customLabels = {};

    getInput.mockReturnValueOnce(JSON.stringify(["feat", "fix"])); // task_types
    getOctokit.mockReturnValue(mockOctokit);

    // Directly call the updateLabels function
    await myModule.updateLabels(
      pr,
      commitDetail,
      customLabels,
      "feat",
      "custom_labels"
    );

    // Assert removeLabel was called for 'feat' and 'breaking change'
    expect(mockOctokit.rest.issues.removeLabel).toHaveBeenCalledWith({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: pr.number,
      name: "feat",
    });
    expect(mockOctokit.rest.issues.removeLabel).toHaveBeenCalledWith({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: pr.number,
      name: "breaking change",
    });
  });
});

describe("generateColor", () => {
  it("should return a string", () => {
    expect(typeof utils.generateColor("test")).toBe("string");
  });

  it("should generate different colors for different inputs", () => {
    const color1 = utils.generateColor("test1");
    const color2 = utils.generateColor("test2");
    expect(color1).not.toEqual(color2);
  });

  it("should generate the same colors for different inputs", () => {
    const color1 = utils.generateColor("test1");
    const color2 = utils.generateColor("test1");
    expect(color1).toEqual(color2);
  });
});

describe("checkScope", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("should return early if commitDetail is null", async () => {
    await myModule.checkScope(null);
    expect(setFailed).not.toHaveBeenCalled();
  });

  it("should return early if commitDetail is undefined", async () => {
    await myModule.checkScope(undefined);
    expect(setFailed).not.toHaveBeenCalled();
  });

  it("should return early if scope_types input is not provided", async () => {
    getInput.mockReturnValue("");
    const commitDetail = { type: "feat", scope: "login", breaking: false };

    await myModule.checkScope(commitDetail);

    expect(setFailed).not.toHaveBeenCalled();
  });

  it("should succeed when scope is valid", async () => {
    getInput.mockReturnValue(JSON.stringify(["login", "signup", "checkout"]));
    const commitDetail = { type: "feat", scope: "login", breaking: false };

    await myModule.checkScope(commitDetail);

    expect(setFailed).not.toHaveBeenCalled();
  });

  it("should succeed when empty scope is allowed and scope is empty", async () => {
    getInput.mockReturnValue(JSON.stringify(["login", "signup", ""]));
    const commitDetail = { type: "feat", scope: "", breaking: false };

    await myModule.checkScope(commitDetail);

    expect(setFailed).not.toHaveBeenCalled();
  });

  it("should fail when scope is invalid", async () => {
    getInput.mockReturnValue(JSON.stringify(["login", "signup", "checkout"]));
    const commitDetail = { type: "feat", scope: "invalid", breaking: false };

    await myModule.checkScope(commitDetail);

    expect(setFailed).toHaveBeenCalledWith(
      "Invalid or missing scope: 'invalid'. Must be one of: login, signup, checkout"
    );
  });

  it("should fail when scope is empty but not allowed", async () => {
    getInput.mockReturnValue(JSON.stringify(["login", "signup", "checkout"]));
    const commitDetail = { type: "feat", scope: "", breaking: false };

    await myModule.checkScope(commitDetail);

    expect(setFailed).toHaveBeenCalledWith(
      "Invalid or missing scope: ''. Must be one of: login, signup, checkout"
    );
  });

  it("should fail when scope_types input is invalid JSON", async () => {
    getInput.mockReturnValue("invalid JSON");
    const commitDetail = { type: "feat", scope: "login", breaking: false };

    await myModule.checkScope(commitDetail);

    expect(setFailed).toHaveBeenCalledWith(
      "Invalid scope_types input. Expecting a JSON array."
    );
  });

  it("should fail when scope_types input is not an array", async () => {
    getInput.mockReturnValue('{"login": "value"}');
    const commitDetail = { type: "feat", scope: "login", breaking: false };

    await myModule.checkScope(commitDetail);

    expect(setFailed).toHaveBeenCalledWith(
      "Invalid scope_types input. Expecting a JSON array."
    );
  });

  it("should not fail when scope is invalid and fail_on_non_conventional is false", async () => {
    getInput.mockImplementation((inputName) => {
      if (inputName === "scope_types") {
        return JSON.stringify(["login", "signup"]);
      }
      if (inputName === "fail_on_non_conventional") {
        return "false";
      }
      return undefined;
    });
    const commitDetail = { type: "feat", scope: "invalid", breaking: false };

    await myModule.checkScope(commitDetail);

    expect(setFailed).not.toHaveBeenCalled();
  });
});

describe("getScopeTypes (via checkScope)", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("should handle when scope_types input is not provided", async () => {
    getInput.mockReturnValue("");
    const commitDetail = { type: "feat", scope: "login", breaking: false };

    await myModule.checkScope(commitDetail);

    expect(setFailed).not.toHaveBeenCalled();
  });

  it("should handle valid JSON array scope_types", async () => {
    getInput.mockReturnValue(JSON.stringify(["login", "signup", "checkout"]));
    const commitDetail = { type: "feat", scope: "login", breaking: false };

    await myModule.checkScope(commitDetail);

    expect(setFailed).not.toHaveBeenCalled();
  });

  it("should handle empty array scope_types", async () => {
    getInput.mockReturnValue(JSON.stringify([]));
    const commitDetail = { type: "feat", scope: "login", breaking: false };

    await myModule.checkScope(commitDetail);

    expect(setFailed).toHaveBeenCalledWith(
      "Invalid or missing scope: 'login'. Must be one of: "
    );
  });

  it("should handle array with empty string scope", async () => {
    getInput.mockReturnValue(JSON.stringify(["login", "signup", ""]));
    const commitDetail = { type: "feat", scope: "", breaking: false };

    await myModule.checkScope(commitDetail);

    expect(setFailed).not.toHaveBeenCalled();
  });

  it("should fail when JSON is invalid", async () => {
    getInput.mockReturnValue("invalid JSON");
    const commitDetail = { type: "feat", scope: "login", breaking: false };

    await myModule.checkScope(commitDetail);

    expect(setFailed).toHaveBeenCalledWith(
      "Invalid scope_types input. Expecting a JSON array."
    );
  });

  it("should fail when JSON is not an array", async () => {
    getInput.mockReturnValue(JSON.stringify({ login: "value" }));
    const commitDetail = { type: "feat", scope: "login", breaking: false };

    await myModule.checkScope(commitDetail);

    expect(setFailed).toHaveBeenCalledWith(
      "Invalid scope_types input. Expecting a JSON array."
    );
  });
});

describe("parseScopeLabelMap", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("should return empty object when input is empty", () => {
    const result = myModule.parseScopeLabelMap("");
    expect(result).toEqual({});
  });

  it("should return empty object when input is undefined", () => {
    const result = myModule.parseScopeLabelMap(undefined);
    expect(result).toEqual({});
  });

  it("should parse valid YAML map", () => {
    const yamlInput = "vis: visualization\nbuilder: expernicorns";
    const result = myModule.parseScopeLabelMap(yamlInput);
    expect(result).toEqual({
      vis: "visualization",
      builder: "expernicorns",
    });
  });

  it("should parse YAML map with special characters in keys", () => {
    const yamlInput = "'@exploreomni/builder': 'expernicorns 🦄'";
    const result = myModule.parseScopeLabelMap(yamlInput);
    expect(result).toEqual({
      "@exploreomni/builder": "expernicorns 🦄",
    });
  });

  it("should fail for invalid YAML", () => {
    const yamlInput = "invalid: yaml: structure:";
    myModule.parseScopeLabelMap(yamlInput);
    expect(setFailed).toHaveBeenCalledWith(
      "Invalid add_scope_label_map input. Unable to parse YAML."
    );
  });

  it("should fail for array instead of object", () => {
    const yamlInput = "- item1\n- item2";
    myModule.parseScopeLabelMap(yamlInput);
    expect(setFailed).toHaveBeenCalledWith(
      "Invalid add_scope_label_map input. Expecting a YAML object with string keys and values."
    );
  });

  it("should fail for non-string values", () => {
    const yamlInput = "key: 123";
    myModule.parseScopeLabelMap(yamlInput);
    expect(setFailed).toHaveBeenCalledWith(
      "Invalid add_scope_label_map input. Expecting a YAML object with string keys and values."
    );
  });
});

describe("applyScopeLabel", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    context.repo = {
      owner: "mockOwner",
      repo: "mockRepo",
    };
  });

  it("should skip when add_scope_label is false", async () => {
    getInput.mockReturnValue("false");
    const pr = { number: 123 };
    const commitDetail = { type: "feat", scope: "login", breaking: false };

    await myModule.applyScopeLabel(pr, commitDetail);

    expect(getOctokit).not.toHaveBeenCalled();
  });

  it("should skip when scope is empty", async () => {
    getInput.mockReturnValue("true");
    const pr = { number: 123 };
    const commitDetail = { type: "feat", scope: "", breaking: false };

    await myModule.applyScopeLabel(pr, commitDetail);

    expect(getOctokit).not.toHaveBeenCalled();
  });

  it("should apply mapped label when scope is in add_scope_label_map", async () => {
    const mockOctokit = {
      rest: {
        issues: {
          listLabelsOnIssue: jest.fn().mockResolvedValue({ data: [] }),
          getLabel: jest.fn().mockResolvedValue({}),
          addLabels: jest.fn().mockResolvedValue({}),
        },
      },
    };
    getInput.mockImplementation((inputName) => {
      if (inputName === "add_scope_label") return "true";
      if (inputName === "add_scope_label_map") return "vis: visualization";
      if (inputName === "add_scope_label_only_existing") return "false";
      if (inputName === "token") return "token";
      return undefined;
    });
    getOctokit.mockReturnValue(mockOctokit);

    const pr = { number: 123 };
    const commitDetail = { type: "feat", scope: "vis", breaking: false };

    await myModule.applyScopeLabel(pr, commitDetail);

    expect(mockOctokit.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: "mockOwner",
      repo: "mockRepo",
      issue_number: 123,
      labels: ["visualization"],
    });
  });

  it("should apply scope directly when not in add_scope_label_map", async () => {
    const mockOctokit = {
      rest: {
        issues: {
          listLabelsOnIssue: jest.fn().mockResolvedValue({ data: [] }),
          getLabel: jest.fn().mockResolvedValue({}),
          addLabels: jest.fn().mockResolvedValue({}),
        },
      },
    };
    getInput.mockImplementation((inputName) => {
      if (inputName === "add_scope_label") return "true";
      if (inputName === "add_scope_label_map") return "vis: visualization";
      if (inputName === "add_scope_label_only_existing") return "false";
      if (inputName === "token") return "token";
      return undefined;
    });
    getOctokit.mockReturnValue(mockOctokit);

    const pr = { number: 123 };
    const commitDetail = { type: "feat", scope: "login", breaking: false };

    await myModule.applyScopeLabel(pr, commitDetail);

    expect(mockOctokit.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: "mockOwner",
      repo: "mockRepo",
      issue_number: 123,
      labels: ["login"],
    });
  });

  it("should not create label when add_scope_label_only_existing is true and label does not exist", async () => {
    const mockOctokit = {
      rest: {
        issues: {
          listLabelsOnIssue: jest.fn().mockResolvedValue({ data: [] }),
          getLabel: jest.fn().mockRejectedValue(new Error("Not found")),
          addLabels: jest.fn().mockResolvedValue({}),
          createLabel: jest.fn().mockResolvedValue({}),
        },
      },
    };
    getInput.mockImplementation((inputName) => {
      if (inputName === "add_scope_label") return "true";
      if (inputName === "add_scope_label_map") return "";
      if (inputName === "add_scope_label_only_existing") return "true";
      if (inputName === "token") return "token";
      return undefined;
    });
    getOctokit.mockReturnValue(mockOctokit);

    const pr = { number: 123 };
    const commitDetail = {
      type: "feat",
      scope: "nonexistent",
      breaking: false,
    };

    await myModule.applyScopeLabel(pr, commitDetail);

    expect(mockOctokit.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(mockOctokit.rest.issues.createLabel).not.toHaveBeenCalled();
  });

  it("should add label when add_scope_label_only_existing is true and label exists", async () => {
    const mockOctokit = {
      rest: {
        issues: {
          listLabelsOnIssue: jest.fn().mockResolvedValue({ data: [] }),
          getLabel: jest.fn().mockResolvedValue({}),
          addLabels: jest.fn().mockResolvedValue({}),
        },
      },
    };
    getInput.mockImplementation((inputName) => {
      if (inputName === "add_scope_label") return "true";
      if (inputName === "add_scope_label_map") return "";
      if (inputName === "add_scope_label_only_existing") return "true";
      if (inputName === "token") return "token";
      return undefined;
    });
    getOctokit.mockReturnValue(mockOctokit);

    const pr = { number: 123 };
    const commitDetail = { type: "feat", scope: "existing", breaking: false };

    await myModule.applyScopeLabel(pr, commitDetail);

    expect(mockOctokit.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: "mockOwner",
      repo: "mockRepo",
      issue_number: 123,
      labels: ["existing"],
    });
  });

  it("should apply mapped label with add_scope_label_only_existing when mapped label exists", async () => {
    const mockOctokit = {
      rest: {
        issues: {
          listLabelsOnIssue: jest.fn().mockResolvedValue({ data: [] }),
          getLabel: jest.fn().mockResolvedValue({}),
          addLabels: jest.fn().mockResolvedValue({}),
        },
      },
    };
    getInput.mockImplementation((inputName) => {
      if (inputName === "add_scope_label") return "true";
      if (inputName === "add_scope_label_map") return "vis: visualization";
      if (inputName === "add_scope_label_only_existing") return "true";
      if (inputName === "token") return "token";
      return undefined;
    });
    getOctokit.mockReturnValue(mockOctokit);

    const pr = { number: 123 };
    const commitDetail = { type: "feat", scope: "vis", breaking: false };

    await myModule.applyScopeLabel(pr, commitDetail);

    expect(mockOctokit.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: "mockOwner",
      repo: "mockRepo",
      issue_number: 123,
      labels: ["visualization"],
    });
  });

  it("should skip when label is already on PR", async () => {
    const mockOctokit = {
      rest: {
        issues: {
          listLabelsOnIssue: jest
            .fn()
            .mockResolvedValue({ data: [{ name: "login" }] }),
        },
      },
    };
    getInput.mockImplementation((inputName) => {
      if (inputName === "add_scope_label") return "true";
      if (inputName === "add_scope_label_map") return "";
      if (inputName === "add_scope_label_only_existing") return "false";
      if (inputName === "token") return "token";
      return undefined;
    });
    getOctokit.mockReturnValue(mockOctokit);

    const pr = { number: 123 };
    const commitDetail = { type: "feat", scope: "login", breaking: false };

    await myModule.applyScopeLabel(pr, commitDetail);

    expect(mockOctokit.rest.issues.addLabels).toBeUndefined();
  });
});
