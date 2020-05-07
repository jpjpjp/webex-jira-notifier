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
    framework.bots.push(new Bot('jshipher@cisco.com'));
    framework.bots.push(new Bot('raschiff@cisco.com'));
    framework.bots.push(new Bot('kboone@cisco.com'));
    framework.bots.push(new Bot('lizlau@cisco.com'));
    framework.bots.push(new Bot("hadougla@cisco.com"));
    framework.bots.push(new Bot('hahsiung@cisco.com'));
    framework.bots.push(new Bot('ramjana@cisco.com'));
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

    // Add test cases by dumping jira webhook payloads
    // into the test cases.  An example test case might be added as follows
    //
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
   
      /* A ticket is created with mentions in the description */
      testCases.push(new TestCase(`${test_dir}/1522768424337-jira:issue_created-issue_created.json`,
        'creates', 'jshipher', 'an unassigned ticket',
        [
          '', '',  // Two users mentioned in description don't have bots
          `{"markdown":"You were mentioned in a Jira Task created by JP Shipherd: **Test Task -- please ignore -- to be deleted**.\\n\\n[~jalumbau], [~hadougla], just confirming that you are getting notifications from the Jira bot.   Let me know or at mention me in a comment.<br /> <br />I will add you and [~shraban] as watchers to this ticket in an effort to understand how Jira exposes watchers in its webhooks\\n\\n${jira_url}/browse/SPARK-7329"}`
        ]));
       
      /* An issue's status is changed */
      testCases.push(new TestCase(`${test_dir}/issue_updated-status_accepted.json`,
        'updated the status', 'ramjana', 'to Done',
        [
          '', //mentioned user does not have a bot
          `{"markdown":"Ramkrishna Jana changed the status to \\\"Done\\\" for Jira Story: **Fix space between \\\"https://\\\" place holder and url textbox** that you are assigned to.\\n\\n!image-2020-04-23-10-09-43-537.png!<br /> <br /> * Remove layout spacing between \\\"https://\\\" place holder and url text edit<br /> * Do not allow modal to stretch\\n\\n${jira_url}/browse/SPARK-137978"}`
        ]));
       
      /* assign an existing ticket to someone using the bot */
      /* This is one of our "special users" not using a cisco email address in jira */
      testCases.push(new TestCase(`${test_dir}/jp-assigns-ralf-issue_updated.json`,
        'assigns to', 'jshipher', 'raschiff',
        [
          `{"markdown":"You were assigned to a Jira Task by JP Shipherd: **Test issue -- ignore**.\\n\\nPlease delete this later. [~jshipher]\\n\\n${jira_url}/browse/SPARKPLAN-360"}`,
          `{"markdown":"JP Shipherd assigned Ralf Schiffert to a Jira Task you are mentioned in: **Test issue -- ignore**.\\n\\nPlease delete this later. [~jshipher]\\n\\n${jira_url}/browse/SPARKPLAN-360"}`
        ]));
     
      /* User using the bot assigns a ticket to themselves */                
      testCases.push(new TestCase(`${test_dir}/jp-assigns-jp-issue_updated.json`,
        'assigns to', 'jshipher', 'jshipher',
        [
          `{"markdown":"You were assigned to a Jira Task by JP Shipherd: **Test issue -- ignore**.\\n\\nPlease delete this later. [~jshipher]\\n\\n${jira_url}/browse/SPARKPLAN-360"}`
        ]));
   
      /* New comment that @mentions a user using the bot and one that isnt */
      testCases.push(new TestCase(`${test_dir}/jp-comments-to-jp-issue_commented.json`,
        'comments mentioning', 'jshipher', 'medash',
        [
          '',
          `{"markdown":"You were mentioned in a comment created by JP Shipherd on a Jira Task: **Hopefully the last test ticket for JP**.\\n\\n[~raschiff].    Thanks for your help with all my tickets today.   I'm making a Jira Notifier bot that lets me know immediately when someone assigns a ticket to me or mentions me in the comments or description.   Let me know if you are interested in trying it. [~medash]\\n\\n${jira_url}/browse/TROPO-11576"}`,
          `{"markdown":"JP Shipherd created a comment on a Jira Task: **Hopefully the last test ticket for JP** that you are assigned to.\\n\\n[~raschiff].    Thanks for your help with all my tickets today.   I'm making a Jira Notifier bot that lets me know immediately when someone assigns a ticket to me or mentions me in the comments or description.   Let me know if you are interested in trying it. [~medash]\\n\\n${jira_url}/browse/TROPO-11576"}`
        ]));
   
      /* An updated comment @mentions a user using the bot */                
      testCases.push(new TestCase(`${test_dir}/jp-updates-comment-to-jp-issue_comment_edited.json`,
        'comments mentioning', 'jshipher', 'jshipher',
        [
          `{"markdown":"JP Shipherd updated a comment on a Jira Task: **Test issue -- ignore** that you are assigned to.\\n\\nC'mon [~jshipher] what are you waiting for?  Changing this to create an comment updated event.\\n\\n${jira_url}/browse/SPARKPLAN-360"}`
        ]));
   
      /* A ticket is deleted that was assigned to a bot user */
      testCases.push(new TestCase(`${test_dir}/liz-deletes-jps-issue_deleted.json`,
        'deletes ticket assigned to', 'lizlau', 'jshipher',
        [
          `{"markdown":"Liz Laub deleted a Jira Task: **Test Issue #2** that you are assigned to.\\n\\n[~lizlau] will delete this soon.\\n\\n${jira_url}/browse/SPARKPLAN-368"}`
        ]));
      /* User updates description of ticket mentioning a user using the bot */
      testCases.push(new TestCase(`${test_dir}/jp-updated-description-issue_updated.json`,
        'updates description mentioning', 'jshipher', 'jshipher',
        [
          `{"markdown":"JP Shipherd updated the description of a Jira Task: **Test issue -- ignore** that you are assigned to.\\n\\nPlease delete this later. [~jshipher].  Actually it looks like you will need to ask someone else to do this since you can;t.\\n\\n${jira_url}/browse/SPARKPLAN-360"}`
        ]));
   
      /* User creates a new ticket and assigns it a bot user */                
      testCases.push(new TestCase(`${test_dir}/jp-creates-for-ralf-issue_created.json`,
        'creates ticket for', 'jshipher', 'raschiff',
        [
          `{"markdown":"You were assigned to a Jira Task by JP Shipherd: **Test Issue #2**.\\n\\n[~lizlau] will delete this soon.\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARKPLAN-368"}`,
          `{"markdown":"JP Shipherd assigned Ralf Schiffert to a Jira Task you are mentioned in: **Test Issue #2**.\\n\\n[~lizlau] will delete this soon.\\n\\n${jira_url}/browse/SPARKPLAN-368"}`
        ]));
   
      /* Ignore a description update when no NEW text was added to the description */
      testCases.push(new TestCase(`${test_dir}/eivhaarr-removes-text-from-description-issue_updated.json`,
        'updates and mentions', 'eivhaarr', 'pmadai',
        ['']));
   
      /* A ticket is assigned with mentions in the description */
      testCases.push(new TestCase(`${test_dir}/issue_update-issue_assigned_to_jp.json`,
        'assigns to', 'jshipher', 'jshipher',
        [
          '', '', '',
          `{"markdown":"JP Shipherd assigned JP Shipherd to a Jira Task you are mentioned in: **Test Task -- please ignore -- to be deleted**.\\n\\n[~jalumbau], [~hadougla], just confirming that you are getting notifications from the Jira bot.   Let me know or at mention me in a comment.<br /> <br />I will add you and [~shraban] as watchers to this ticket in an effort to understand how Jira exposes watchers in its webhooks\\n\\n${jira_url}/browse/SPARK-7329"}`,
          `{"markdown":"You were assigned to a Jira Task by JP Shipherd: **Test Task -- please ignore -- to be deleted**.\\n\\n[~jalumbau], [~hadougla], just confirming that you are getting notifications from the Jira bot.   Let me know or at mention me in a comment.<br /> <br />I will add you and [~shraban] as watchers to this ticket in an effort to understand how Jira exposes watchers in its webhooks\\n\\n${jira_url}/browse/SPARK-7329"}`
        ]));
   
      /* A ticket with watchers (one using the bot) gets a new comment (without any mentions) */
      testCases.push(new TestCase(`${test_dir}/1522952365307-jira:issue_updated-issue_commented.json`,
        'comments', 'jshipher', 'without any mentions',
        [
          '',
          `{"markdown":"JP Shipherd created a comment on a Jira Task: **Test Task -- please ignore -- to be deleted** that you are assigned to.\\n\\nTesting behavior when a new notification without mentions is added to a ticket with watchers.\\n\\n${jira_url}/browse/SPARK-7329"}`
        ]));
   
      /* A ticket is created with mentions in the description */
      testCases.push(new TestCase(`${test_dir}/1522768424337-jira:issue_created-issue_created.json`,
        'creates', 'jshipher', 'an unassigned ticket',
        [
          '', '',  // Two users mentioned in description don't have bots
          `{"markdown":"You were mentioned in a Jira Task created by JP Shipherd: **Test Task -- please ignore -- to be deleted**.\\n\\n[~jalumbau], [~hadougla], just confirming that you are getting notifications from the Jira bot.   Let me know or at mention me in a comment.<br /> <br />I will add you and [~shraban] as watchers to this ticket in an effort to understand how Jira exposes watchers in its webhooks\\n\\n${jira_url}/browse/SPARK-7329"}`
        ]));
       
      /* The status of ticket with watchers using the bot was updated */
      /* No change to assignments or mentions so only watchers (one using the bot) are notified */
      testCases.push(new TestCase(`${test_dir}/1522768650390-jira:issue_updated-issue_generic.json`,
        'changes', 'jshipher', 'status',
        [ '', '', '', // No assignees or @mentions generate update
          `{"markdown":"JP Shipherd changed the status to \\"In Progress\\" for Jira Task: **Test Task -- please ignore -- to be deleted**.\\n\\n[~jalumbau], [~hadougla], just confirming that you are getting notifications from the Jira bot.   Let me know or at mention me in a comment.<br /> <br />I will add you and [~shraban] as watchers to this ticket in an effort to understand how Jira exposes watchers in its webhooks\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARK-7329"}`,
          `{"markdown":"JP Shipherd changed the status to \\"In Progress\\" for Jira Task: **Test Task -- please ignore -- to be deleted** that you are assigned to.\\n\\n[~jalumbau], [~hadougla], just confirming that you are getting notifications from the Jira bot.   Let me know or at mention me in a comment.<br /> <br />I will add you and [~shraban] as watchers to this ticket in an effort to understand how Jira exposes watchers in its webhooks\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARK-7329"}`
        ]));
   
      /* An updated comment @mentions a user using the bot */                
      testCases.push(new TestCase(`${test_dir}/jp-updates-comment-to-jp-issue_comment_edited.json`,
        'comments mentioning', 'jshipher', 'jshipher',
        [
          `{"markdown":"JP Shipherd updated a comment on a Jira Task: **Test issue -- ignore** that you are assigned to.\\n\\nC'mon [~jshipher] what are you waiting for?  Changing this to create an comment updated event.\\n\\n${jira_url}/browse/SPARKPLAN-360"}`
        ]));
   
      /* Process a multi-line comment correctly */
      testCases.push(new TestCase(`${test_dir}/1523460120955-jira:issue_updated-issue_comment_edited.json`,
        'updates and mentions', 'jshipher', 'jsoliman',
        [
          '',  // nobody with a bot is assigned or mentioned in the description of this ticket
          `{"markdown":"JP Shipherd updated a comment on a Jira Task: **Create analysis tool and use it to compare & analyzing pricing api results from middleware and PAPI** that you are watching.\\n\\nHi [~jsoliman], I suspect a lot of these differences will go away if you point to the same Billwise instance.   The easiest thing to do is probably have you point your test system to the production instance of billwise.  I have read only access credentials that I can share with you if you ping me on Spark.   Talk to Hancheng and make sure he's OK with that.  If suspect this will make 90% of the differences go away.<br />If you are strongly against pointing to production billwise, I can help you spin up a local instance of the middleware talking to whatever instance of BW you are talking to.   With that said, I think production is better since if there are differences in the data (which their obviously are), there might be a problem that we don't catch.  Either way just ping me on Spark and we'll come up with a plan.<br />Thanks for doing this!\\n\\n${jira_url}/browse/TROPO-13333"}`,
          `{"markdown":"JP Shipherd updated a comment on a Jira Task: **Create analysis tool and use it to compare & analyzing pricing api results from middleware and PAPI** that you are watching.\\n\\nHi [~jsoliman], I suspect a lot of these differences will go away if you point to the same Billwise instance.   The easiest thing to do is probably have you point your test system to the production instance of billwise.  I have read only access credentials that I can share with you if you ping me on Spark.   Talk to Hancheng and make sure he's OK with that.  If suspect this will make 90% of the differences go away.<br />If you are strongly against pointing to production billwise, I can help you spin up a local instance of the middleware talking to whatever instance of BW you are talking to.   With that said, I think production is better since if there are differences in the data (which their obviously are), there might be a problem that we don't catch.  Either way just ping me on Spark and we'll come up with a plan.<br />Thanks for doing this!\\n\\n${jira_url}/browse/TROPO-13333"}`
        ]));   
      /* Create a new ticket and assign it to a bot user */
      testCases.push(new TestCase(`${test_dir}/1523584338774-jira:issue_created-issue_created.json`,
        'creates and assigns', 'jshipher', 'jshipher',
        [
          `{"markdown":"You were assigned to a Jira Task by JP Shipherd: **Testing 3**.\\n\\nTesting 3\\n\\n${jira_url}/browse/OPS-9914"}`
        ]));
   
      /* A ticket's description was changed no one was mentioned but there are some watchers using the bot */
      testCases.push(new TestCase(`${test_dir}/1522969970738-jira:issue_updated-issue_updated.json`,
        'edited the', 'charlin', 'description',
        [
          '', '', // No users are mentioned so no notifications for that
          `{"markdown":"Charles Lin updated the description of a Jira Bug: **ios spark - roster list should transition to 'closed' state when user switch back to in-meeting view** that you are watching.\\n\\nios spark - roster list should be closed\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARK-7645"}`,
        ]));
   
      /* A ticket was moved to the work started state and assigned to a bot user */
      /* User doesn't want to be notified about their own changes, but a watcher will be notified */
      testCases.push(new TestCase(`${test_dir}/1522969913206-jira:issue_updated-issue_work_started.json`,
        'assigns to', 'hahsiung', 'hahsiung',
        [
          '', // Mentioned user is the editor and they don't have notification turned on for their own edits
          '', // Another non bot watcher has been added
          `{"markdown":"Hancheng Hsiung changed the status to \\"In Development\\" for Jira Bug: **Failed the api call to addservice for short code number due to new logic for \\"pricingPrefix\\"** that you are watching.\\n\\nHi Mike and Wing<snip>\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/TROPO-13320"}`
        ]));
    }
  }

}

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
      if ((bot.isDirectTo == 'jshipher@cisco.com') || (bot.isDirectTo == 'ramjana@cisco.com')) {
        resolve({'askedExit': false, 'notifySelf': true});
      } else {
        resolve({'askedExit': false});
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
