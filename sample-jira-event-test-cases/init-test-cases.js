// init-test-cases.js
// This file initializes the set of test bot users
// and the set of test cases that will be used
// by the jira notifier test-jira-event-handler test

// It is expected that a developer will update this file
// to include tests for their own jira system
// The current content is purely for illustration purposes

// Directory for test cases must be specified ie:
// TEST_CASE_DIR=sample-test-cases npm run test

class JiraTestCases {

  /**
   * Init bot users
   * 
   * Modify this code to create the bot users that 
   * should be notified by your test cases
   *
   * @function initBotUsers
   * @param {object} framework - the framework object to create bots in
   */
  initBotUsers(framework) {
    // Add a line for each user who should receive notifications
    // If your example events include tickets assigned to jane@company.com
    // and mention fred@company.com you might have the following lines
    // 
    // framework.bots.push(new Bot('jane@company.com'));
    // framework.bots.push(new Bot('fred@company.com'));
    framework.bots.push(new Bot('jane@company.com'));
    framework.bots.push(new Bot('fred@company.com'));
  }

  /**
   * Init test cases
   * 
   * Modify this code to create the test cases array
   * Each test case includes the following
   *
   * @function initBotUsers
   * @param {object} testCases - An array to add test case objects to
   * @param {string} test_dir - Directory where the test case files are
   * @param {string} jira_url - Top level url for jira system under test
   */
  initTestCases(testCases, test_dir, jira_url) {

    // Add test cases by writing jira webhook payloads to files
    // The bot will write all jira events to a JiraEvents directory if the
    // environment variable LOG_JIRA_EVENTS is set to "true"
    // It will also attempt to log the event to the potential-jira-event-test-cases
    // whenver a runtime error is encountered processing an event
    //
    // To add an event file as a test case push a test case object onto
    // the testCases list that is passed into this function.   A test cases
    // object consists of:
    // * the path to the event json file
    // * a string describing the action in the events file
    // * a string describing the author of the event
    // * a string describing the target of the event
    // * an array of expected response.  A response will be an empty string
    //   for a watcher or user who is discovered but does not have a bot,
    //   it will be the full text of the bot notification for the users who do have a bot
    // See the end of this file for the object definition.
    
    // Example:
    // /* A description of what the event payload represents is handy */
    // testCases.push(new TestCase(`${test_dir}/example-test-payload.json`,
    //   'description of action', 'author name', 'description of subject,
    //   [
    //     // List all expected messages in an array
    //     '', add an empty message for mentioned or assigned users without a bot
    //     {"markdown": "Jane User created a Jira Story: **This is the Title** you were mentioned in.\\n\\nThis is the story description\\n\\n${jira_url}/browse/PROJECT-KEY`}   
    //   ]))
    
    // When adding new test cases its not always clear what the results will be
    // Leaving the expected result array blank and looking at the test output can help
    // If the output looks right, copy the results into the expected responses array
    // Don't forget to escape any backslashes in the response


    // It is sometimes handy to debug only one event at a time
    // Set the TEST_CASES=SUBSET environment and copy the test of
    // interest below
    if (process.env.TEST_CASES == 'SUBSET') {
      /* Quick way to test a problem issue */
      /* @mention multiple people only one of whom is using the bot */
      testCases.push(new TestCase(`${test_dir}/jp-comments-to-ralf-nobody1-issue_commented.json`,
        'comments mentioning', 'jshipher', 'raschiff and nobody1',
        [
          '',
          `{"markdown":"You were mentioned in a comment created by JP Shipherd on a Jira Task: **Hopefully the last test ticket for JP**.\\n\\n[~raschiff].    Thanks for your help with all my tickets today.   I'm making a Jira Notifier bot that lets me know immediately when someone assigns a ticket to me or mentions me in the comments or description.   Let me know if you are interested in trying it. [~nobody1]\\n\\n${jira_url}/browse/TROPO-11576"}`,
          `{"markdown":"JP Shipherd created a comment on a Jira Task: **Hopefully the last test ticket for JP** that you are assigned to.\\n\\n[~raschiff].    Thanks for your help with all my tickets today.   I'm making a Jira Notifier bot that lets me know immediately when someone assigns a ticket to me or mentions me in the comments or description.   Let me know if you are interested in trying it. [~nobody1]\\n\\n${jira_url}/browse/TROPO-11576"}`
        ]));
   
    } else {
      /* 
       *  Full set of test cases go here
       */
      /* A ticket is assigned with mentions in the description */
      testCases.push(new TestCase(`${test_dir}/issue_update-issue_assigned_to_jp.json`,
        'assigns to', 'jshipher', 'jshipher',
        [
          '', '', '',
          `{"markdown":"You were assigned to a Jira Task by JP Shipherd: **Test Task -- please ignore -- to be deleted**.\\n\\n[~jalumbau], [~hadougla], just confirming that you are getting notifications from the Jira bot.   Let me know or at mention me in a comment.<br /> <br />I will add you and [~shraban] as watchers to this ticket in an effort to understand how Jira exposes watchers in its webhooks\\n\\n${jira_url}/browse/SPARK-7329"}`,
          `{"markdown":"JP Shipherd assigned JP Shipherd to a Jira Task you are mentioned in: **Test Task -- please ignore -- to be deleted**.\\n\\n[~jalumbau], [~hadougla], just confirming that you are getting notifications from the Jira bot.   Let me know or at mention me in a comment.<br /> <br />I will add you and [~shraban] as watchers to this ticket in an effort to understand how Jira exposes watchers in its webhooks\\n\\n${jira_url}/browse/SPARK-7329"}`
        ]));
   
      /* @mention multiple people only one of whom is using the bot */
      testCases.push(new TestCase(`${test_dir}/jp-comments-to-ralf-nobody1-issue_commented.json`,
        'comments mentioning', 'jshipher', 'raschiff and nobody1',
        [
          '',
          `{"markdown":"You were mentioned in a comment created by JP Shipherd on a Jira Task: **Hopefully the last test ticket for JP**.\\n\\n[~raschiff].    Thanks for your help with all my tickets today.   I'm making a Jira Notifier bot that lets me know immediately when someone assigns a ticket to me or mentions me in the comments or description.   Let me know if you are interested in trying it. [~nobody1]\\n\\n${jira_url}/browse/TROPO-11576"}`,
          `{"markdown":"JP Shipherd created a comment on a Jira Task: **Hopefully the last test ticket for JP** that you are assigned to.\\n\\n[~raschiff].    Thanks for your help with all my tickets today.   I'm making a Jira Notifier bot that lets me know immediately when someone assigns a ticket to me or mentions me in the comments or description.   Let me know if you are interested in trying it. [~nobody1]\\n\\n${jira_url}/browse/TROPO-11576"}`
        ]));
}

// The rest of this file creates simulate versions of the Framework and Bot objects
// For the most part this can be ignored, however if you want to test 
// the behavior for various user settings (ie: some user turned watcher notifications
// off, you can manipulate the bot.recall method below)

// Create our own verion of the bot objects that supports our test cases.
function Bot(isDirectTo) {
  this.isDirect = true;
  this.isDirectTo = isDirectTo;
  this.jiraEventMessage = '';
}
// jiraEventHandler will call bot.recall to see if the user asked to turn off notificaitons
// For testing we'll assume we always want to get the notifications
Bot.prototype.recall = function (key) {
  let bot = this;
  return new Promise(function (resolve, reject) {
    if (key === 'userConfig') {
      if (bot.isDirectTo == 'jshipher@cisco.com') {
        resolve({'askedExit': false, 'notifySelf': true, "watcherMsgs": false});
      } else {
        resolve({'askedExit': false, 'notifySelf': false, "watcherMsgs": true});
      }
    } else {
      let msg = 'Test harness got unexpected bot.recall() call with key:' + key;
      console.error(msg);
      reject(new Error(msg));
    }
  });
};

// jiraEventHandler will call bot.store to save info about the last notification
// This is not currently used in the tests
Bot.prototype.store = function () {
  return new Promise(function (resolve) {
    resolve(true);
  });
};


// jiraEventHandler will call bot.say to send a result to a Spark user
Bot.prototype.say = function () {
  // say can take one or two args.   We only care about the second for our cannonical result
  var args = Array.prototype.slice.call(arguments);
  // determine if a format is defined in arguments
  // first and second arguments should be string type
  // first argument should be one of the valid formats
  var formatDefined = (args.length > 1 && typeof args[0] === 'string' && typeof args[1] === 'string' && _.includes(['text', 'markdown', 'html'], _.toLower(args[0])));
  // if format defined in function arguments, overide default
  if (formatDefined) {
    format = _.toLower(args.shift());
  }
  // if message is object (raw)
  if (typeof args[0] === 'object') {
    this.jiraEventMessage += JSON.stringify(args[0]) + '\n';
  } else if (typeof args[0] === 'string') {
    this.jiraEventMessage += args[0] + '\n';
  } else {
    return when.reject(new Error('Invalid function arguments'));
  }
};

// Build the list of cannonical test objects.
function TestCase(file, action, author, subject, result) {
  this.file = file;
  this.action = action;
  this.author = author;
  this.subject = subject;
  this.result = result;
  this.resultsSeen = 0;
  this.numExpectedResults = result.length;
  this.numPassed = 0;
  this.numSeenErrors = 0;
}


module.exports = JiraTestCases;
