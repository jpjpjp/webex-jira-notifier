/**
 * This file defines a template configuration to define test cases
 * for the group notifier module.
 * 
 * The content of the test cases is dependent on the jira system you 
 * are testing with so, each developer will configure their own test cases.
 * 
 * The transition test app does not interact with the webex system.
 * It creates stub framework and bot objects that emulate the behavior
 * of the webex-node-bot-framework.
 * 
 * The transition tests DO interact with configured jira system.  
 * The addFiltersToSpace tests will lookup the specified filters in
 * the configured jira systam and load the list of issues associated 
 * with them into the application's issue cache.   
 * 
 * If all the addFiltersToSpace tests (the initTestCases) pass, the test
 * app reads in each of the test cases defined in this object.  Each test
 * case defines canned jira webhook event data file (in the TEST_CASE_DIR), 
 * as well as defining the expected notifications the bots will deliver
 * in response to it. 
 *
 * When processing these events calls are made to the jira system in the
 * new issue test cases to see if they match the filter criteria.  As 
 * a consequence, tests will only work for any canned new issue jira event
 * data if the issue still exists in the jira system (and still matches)
 * the filter criteria specified in the test
 * 
 * Rename this file to transition-test-config.js before 
 * adding your own configuration.
 * 
 * The following objects can be set in the testCaseConfig object
 * 
 *
 * @property {array<strings>} botsToTest - Specify strings for space titles.  At least one space title must be specified. 
 * @property {array<objects} addBoardToSpaceTest - As set of tests to emulate button presses to send an "Add Board" request to one of the test bots.   At least one button press must be specified.
 * @property {array<objects} firstPassTestCases - A set of tests to process canned jira events and determine if the configured bots return the expected notifications.   At least one jira-event test case must be specified.
 * @property {array<objects} addBoardToSpaceTest - As set of tests to emulate button presses to send an "Remove Board" request to one of the test bots. 
 * @property {array<objects} firstPassTestCases - A set of jira event tests to run after some boards have been removed from some bots.  Typicaly these are the same tests specified in the first path with fewer expected notifications.
 *
 */

exports.testConfig = {
  // Specify the number of bots to create for the transition tests
  // Provide a "space name", for each bot
  botsToTest: [
    'Example space name for the first bot in the test cases',
    'Space name for a second bot',
    'The third bot\'s space name',
  ],
  // Specify the tests to emulate users asking the bot to add
  // new filters to watch.   
  addBoardsToSpacesTests: [
    {
      // testType specifies the logic to test.  Valid values are:
      // 'transitionTest' - these are run when SKIP_BOARD_TRANSITION_NOTIFICATIONS is not set
      // 'newIssueTest' - these are run when SKIP_NEW_ISSUE_NOTIFICATIONS is not set
      testType: "transitionTest",
      // Testname is ouptut in the report if it fails or if VERBOSE is set
      testName: "bot1 adds boardId 4263",
      // index in the botsToTest array to configure
      botIndex: 0,
      // board or filter identifier to load
      // emulates data when action.Submit on Add Filters card
      // this could be a complete URL to a filter or board or just the ID
      boardOrFilterId: "4263",
      // board or filter type.  May be "board", "filter" or null
      // When null the system attempts to determine the type
      // emulates data when action.Submit on Add Filters card
      boardType: "board",
      // Set to resolve if test is expected to pass, reject if expected to fail
      expectedResult: "resolve", 
      // The expected name of the board or filter that is being loaded
      // This must match result from jira in order for test to pass
      expectedMessage: "The name of the board with the ID 4263"
    },
    {
      // Add more tests for the boards and filters you want to test
      // Its useful to include some test cases that may fail as well
      testType: "transitionTest",
      testName: "bot3 adds invalid boardId 428999",
      botIndex: 2,
      boardOrFilterId: "428999",
      boardType: "board", 
      expectedResult: "reject",
      expectedMessage: "Unable to find board 428999\nMake sure to specify the correct board/filter type and ensure permissions allow view access to all jira users."
    },
    {
      testType: "transitionTest",
      testName: "bot3 adds board via bad jira url",
      botIndex: 2,
      boardOrFilterId: "https://jira-foo.foobar.com/jira/secure/RapidBoard.jspa?rapidView=4263",
      boardType: null, 
      expectedResult: "reject",
      expectedMessage: "Could not find a board or filter matching https://jira-foo.foobar.com/jira/secure/RapidBoard.jspa?rapidView=4263"
    },
    {
      testType: "transitionTest",
      testName: "bot3 adds filterId 34567 but says its a board",
      botIndex: 2,
      boardOrFilterId: "34567",
      boardType: "board", 
      expectedResult: "reject",
      expectedMessage: "Unable to find board 34567\nMake sure to specify the correct board/filter type and ensure permissions allow view access to all jira users."
    },
    {
      testType: "transitionTest",
      testName: "bot3 adds filter that bot jira act cant see",
      botIndex: 2,
      boardOrFilterId: "35071",
      boardType: "filter", 
      expectedResult: "reject",
      expectedMessage: "Unable to find filter 35071\nMake sure to specify the correct board/filter type and ensure permissions allow view access to all jira users."
    }
  ],
  firstPassTestCases: [
    // Specify the test cases to process canned jira events
    {
      // These tests will identify a file that the developer has placed in a
      // folder specified via the TEST_CASE_DIR directory.  Each file should be
      // the JSON payload of a jira webhook event.  
      // Note that running the server with LOG_JIRA_EVENTS environment variable set
      // will write all incoming jira events to files in the JiraEvents folder in this project

      // testType specifies the logic to test.  Valid values are:
      // 'transitionTest' - these are run when SKIP_BOARD_TRANSITION_NOTIFICATIONS is not set
      // 'newIssueTest' - these are run when SKIP_NEW_ISSUE_NOTIFICATIONS is not set
      testType: 'transitionTest',
      // Path to the json file with the jira event to test
      eventData: "jira_issue_updated-status-of-issue-on-board-4263.json",
      // Info on what caused the event -- used in the test report
      userAction: 'changed', 
      user: 'Joe Jira', 
      userTarget: 'status',
      // An array of expected Notifcations the event should generate
      // The format is the Webex message object the app will pass to bot.say()
      expectedNotifications: [
        `{"markdown":"Joe Jira transitioned a(n) Epic from Definition to Delivery:\\n* [PROJECT-121212](https://jira.company.com/jira/browse/PROJECT_121212): Jira Title\\n* Components: Client: Android, Client: Desktop (Windows and MacOS), Client: iOS, Client: Web\\n\\nWhich matches the filter: The name of the board with the ID 4263(https://jira-company.com/jira/issues/?filter=34567)"}`,
        `{"markdown":"Joe Jira transitioned a(n) Epic from Definition to Delivery:\\n* [PROJECT-121212](https://jira.company.com/jira/browse/PROJECT_121212): Jira Title\\n* Components: Client: Android, Client: Desktop (Windows and MacOS), Client: iOS, Client: Web\\n\\nWhich matches the filter: The name of the board with the ID 4263(https://jira-company.com/jira/issues/?filter=34567)"}`
      ]
    }
  ],
  boardDeleteTests: [
    // Specify the bots to send a "delete board(s)" message to
    {
      // Index into the botsToTest array to send button press to
      botIndex: 1,
      // Emulate an attachmentActions.inputs field for an Input.Choice multi select field
      boardsToDelete: "4263:board,2885:board,34567:filter"
    }
  ],
  secondPassTestCases: [
    // Specify the test cases to process canned jira events
    {
      // These are usually the same tests as the firstPassTestCases
      // although perhaps with fewer expected notifications given that
      // some boards were deleted from some bots

      // testType specifies the logic to test.  Valid values are:
      // 'transitionTest' - these are run when SKIP_BOARD_TRANSITION_NOTIFICATIONS is not set
      // 'newIssueTest' - these are run when SKIP_NEW_ISSUE_NOTIFICATIONS is not set
      testType: 'transitionTest',
      // Path to the json file with the jira event to test
      eventData: "jira_issue_updated-status-of-issue-on-board-4263.json",
      // Info on what caused the event -- used in the test report
      userAction: 'changed', 
      user: 'Joe Jira', 
      userTarget: 'status',
      // An array of expected Notifcations the event should generate
      // The format is the Webex message object the app will pass to bot.say()
      expectedNotifications: [
        `{"markdown":"Joe Jira transitioned a(n) Epic from Definition to Delivery:\\n* [PROJECT-121212](https://jira.company.com/jira/browse/PROJECT_121212): Jira Title\\n* Components: Client: Android, Client: Desktop (Windows and MacOS), Client: iOS, Client: Web\\n\\nWhich matches the filter: The name of the board with the ID 4263(https://jira-company.com/jira/issues/?filter=34567)"}`
      ]
    }
  ],
};
