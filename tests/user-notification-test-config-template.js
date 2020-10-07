/**
 * This file defines a template configuration to define test cases
 * for the main jira (1-1) user notifier app.
 * 
 * In general, the content of the test cases is dependent on the jira system you 
 * are testing with so, each developer will configure their own test cases.
 * For 1-1 notifications it is possible to test mention and assignment
 * notifications without being connected to an actual jira system.  To
 * run in this mode set the environment NO_JIRA_CONNECTION_TEST_DOMAIN
 * to the email domain to add to jira users.   When this is set, the jira
 * methods lookupUsers will create an artifical user class combining the user
 * name and the specified domain name if lookup fails.  The lookupWatcher
 * class will generate an artification result with no watchers.
 * 
 * The transition test app does not interact with the webex system.
 * It creates stub framework and bot objects that emulate the behavior
 * of the webex-node-bot-framework.
 *   
 * Rename this file to user-notification-test-config.js before 
 * adding your own configuration.
 * 
 * The following objects can be set in the testCaseConfig object
 *
 * @property {array<objects} botsUnderTest - A set of objects with the email of a jira user, and their notification configuration
 * @property {array<objects} testCases - A set of jira event tests to run after some boards have been removed from some bots.  Typicaly these are the same tests specified in the first path with fewer expected notifications.
 *
 */

let botsUnderTest = [
  // Specify and object with eamil of the user with 1-1 spaces with the bot
  // Emails should generally match users with jira accounts
  // The object should also contain a config that sets 2 or 3 booleans:
  //    askedExit -- if true user should get no notifications
  //    watcherMsgs -- if true user wants notifications about watched issues
  //    notifySelf -- if true notify user of changes they made
  {
    email: "john@company.com",
    config: {'askedExit': false, "watcherMsgs": true, 'notifySelf': true}
  },
  {
    email: "jane@company.com",
    config: {'askedExit': false, "watcherMsgs": true}
  },
  {
    email: "ramesh@company.com",
    config: {'askedExit': false, "watcherMsgs": true, 'notifySelf': true}
  }
];


exports.testConfig = {
  botsUnderTest,
  testCases: [
    // Specify the test cases to process canned jira events
    {
      // These tests will identify a file that the developer has placed in a
      // folder specified via the TEST_CASE_DIR directory.  Each file should be
      // the JSON payload of a jira webhook event.  
      // Note that running the server with LOG_JIRA_EVENTS environment variable set
      // will write all incoming jira events to files in the JiraEvents folder in this project

      // When using events from a the actual jira system under test, the jira 
      // event handler will attempt to lookup watchers and resolve mentioned 
      // user's email address with API calls into the jira system

      // Alternately, its possible to create truly "canned" Jira Event payload
      // for test purpose only.  These jira-event-handler class will generate 
      // error messages complaning that it failed looking up watchers for the issue
      // but notifications to m...

      // Path to the json file with the jira event to test
      eventData: "john-updates-comment-to-jane-issue_comment_edited.json",
      // Info on what caused the event -- used in the test report
      userAction: 'comments mentioning', 
      user: 'john', 
      userTarget: 'jane',
      // An array of expected Notifcations the event should generate
      // The format is the Webex message object the app will pass to bot.say()
      expectedNotifications: [
        `{"markdown":"John Smith updated a comment on a Jira Task: **Test issue -- ignore** that you are assigned to.\\n\\n[~jane] what should we do next?\\n\\nhttps://jira.company.com/jira/browse/PROJECT-360"}`
      ]
    },
    {
      /* A ticket is assigned with mentions in the description */
      eventData: "ramesh-assigns-to-jane.json",
      userAction: "assigns to", 
      user: "ramesh", 
      userTarget: "jane",
      expectedNotifications: [
        `{"markdown":"You were assigned to a Jira Task by Ramesh Sharma: **Test Task -- please ignore -- to be deleted**.\\n\\n[~john], just confirming that you are getting notifications from the Jira bot.\\n\\nhttps://jira.company.com/jira/browse/PROJECT-7329"}`,
        `{"markdown":"You were mentioned in a Jira Task changed by Ramesh Sharma: **Test Task -- please ignore -- to be deleted**.\\n\\n[~john], just confirming that you are getting notifications from the Jira bot.\\n\\nhttps://jira.company.com/jira/browse/PROJECT-7329"}`
      ]
    }
  ]
};

