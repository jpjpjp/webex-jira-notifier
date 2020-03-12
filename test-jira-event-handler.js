// test-jira-event-handler.js
// Run some prepared jira event through the handler to ensure
// that we get our expected results
/*jshint esversion: 6 */  // Help out our linter

// Helper classes for dealing with Jira Webhook payload
var jiraEventHandler = require("./jira-event.js");
fs = require('fs');

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
    if (key === 'user_config') {
      if (bot.isDirectTo == 'jshipher@cisco.com') {
        resolve({'askedExit': false, 'notifySelf': true});
      } else {
        resolve({'askedExit': false});
      }
    } else {
      reject(console.error('Test harness got unexpected bot.recall() call with key:' + key));
    }
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


// Create our own verion of the Framework object that supports our test cases.
function Framework() {
  this.bots = [];
}
// jiraEventHandler calls framework.debug.   We don't care about this for our tests
Framework.prototype.debug = function (message) {
  if ((process.env.DEBUG) && (process.env.DEBUG.toLowerCase().substring('framework'))) {
    console.log(message);
  }
};
// Build the list of "bots" that we want our test suite to run against
// The current set assumes all users work for ciso
framework = new Framework();
framework.bots.push(new Bot('jshipher@cisco.com'));
framework.bots.push(new Bot('raschiff@cisco.com'));
framework.bots.push(new Bot('kboone@cisco.com'));
framework.bots.push(new Bot('lizlau@cisco.com'));
framework.bots.push(new Bot("hadougla@cisco.com"));
framework.bots.push(new Bot('hahsiung@cisco.com'));
let emailOrg = 'cisco.com';


// Build the list of cannonical test objects.
function TestCase(file, action, author, subject, result) {
  this.file = file;
  this.action = action;
  this.author = author;
  this.subject = subject;
  this.result = result;
  this.resultsSeen = 0;
}
var testCases = [];
/**/
/* Quick way to test a problem issue */
// testCases.push(new TestCase('./jira-event-test-cases/1519807348530-jira:issue_updated-issue_updated.error',
//                 'error', '', '',
//                 [''], 1));
/* Specify Test Cases
/* @mention a user who is not using the bot */
//testCases.push(new TestCase('./jira-event-test-cases/comment-dorin-medash-jira:issue_updated-issue_commented.json',
//                'comments', 'dorin', 'medash', [''], 1));


/* A ticket's description was changed no one was mentioned but there are some watchers using the bot */
testCases.push(new TestCase('./jira-event-test-cases/1522969970738-jira:issue_updated-issue_updated.json',
  'edited the', 'charlin', 'description',
  [
    '', // No users are mentioned so no notifications for that
    `{"markdown":"Charles Lin updated a Jira Bug: **ios spark - roster list should transition to \'closed\' state when user switch back to in-meeting view** that you are watching.\\n\\n>updated field:description to:\\"ios spark - roster list should be closed when user switch back to in-meeting view<br />currently if you open and view the roster list, then tap the small PIP (which shows the in-meeting content) to return to the in-meeting view, the roster list is not considered to be 'closed'.   <br />A consequence of that is user will have trouble getting back to the app main UI/main option menu when user wants to submit feedback.   If user now wants to submit feedback, by tapping upper left corner 'minimize' button, instead of seeing the spark main UI which shows options of \\"Message\\", \\"Teams\\", \\"Call\\", \\"Meetings\\", and \\"Me\\", you are back to seeing the opened roster list instead.<br />Now, let's say user even decides to try to find/get to the Me option UI, by tapping the 'Close' button on upper left corner of the roster list, when roster list is closed, instead of showing user the main UI with the spark app's main menu options at bottom, it goes back to showing the in-meeting content full screen.   So user gets the impression that it is impossible to find/get to the 'Me' > 'Submit Feedback' UI<br />see video<br />As a comparison, Android does not show this particular behavior, so it is always easy for user to navigate and find the Me > Submit Feedback UI<br />\\"\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARK-7645"}`,
  ]));

/* A ticket was moved to the work started state and assigned to a bot user */
/* User doesn't want to be notified about their own changes, but a watcher will be notified */
testCases.push(new TestCase('./jira-event-test-cases/1522969913206-jira:issue_updated-issue_work_started.json',
  'assigns to', 'hahsiung', 'hahsiung',
  [
    '', // Mentioned user is the editor and they don't have notification turned on for their own edits
    `{"markdown":"Hancheng Hsiung updated a Jira Bug: **Failed the api call to addservice for short code number due to new logic for \\"pricingPrefix\\"** that you are watching.\\n\\n>updated field:assignee from:\\"Wing Tang\\" to:\\"Hancheng Hsiung\\", and updated field:status from:\\"Open\\" to:\\"Hancheng Hsiung\\"\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/TROPO-13320"}`
  ]));

/* A ticket with watchers gets a new comment and some watchers are mentioned */
testCases.push(new TestCase('./jira-event-test-cases/1522952583499-jira:issue_updated-issue_commented.json',
  'comments', 'jshipher', 'without any mentions',
  [
    '', '',   // There are two mentioned people not using the bot
    `{"markdown":"JP Shipherd mentioned you in the Jira Task: **Test Task -- please ignore -- to be deleted**\\n\\n>Testing behavior when a new notification WITH mentions is added to a ticket with watchers.<br /> <br />[~jalumbau], [~shraban], [~hadougla] note that I'm testing this in my own dev environment at the moment.  You won't see updates from the bot until I push it to deployment.   Will post when that happens.\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARK-7329"}`,
    `{"markdown":"JP Shipherd commented on a Jira Task: **Test Task -- please ignore -- to be deleted** that you are watching.\\n\\n>Testing behavior when a new notification WITH mentions is added to a ticket with watchers.<br /> <br />[~jalumbau], [~shraban], [~hadougla] note that I'm testing this in my own dev environment at the moment.  You won't see updates from the bot until I push it to deployment.   Will post when that happens.\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARK-7329"}`
  ]));

/* A ticket with watchers gets a new comment (without any mentions) */
testCases.push(new TestCase('./jira-event-test-cases/1522952365307-jira:issue_updated-issue_commented.json',
  'comments', 'jshipher', 'without any mentions',
  [
    `{"markdown":"JP Shipherd commented on a Jira Task: **Test Task -- please ignore -- to be deleted** that you are watching.\\n\\n>Testing behavior when a new notification without mentions is added to a ticket with watchers.\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARK-7329"}`,
  ]));

/* A ticket is assigned with mentions in the description */
testCases.push(new TestCase('./jira-event-test-cases/issue_update-issue_assigned_to_jp.json',
  'assigns to', 'jshipher', 'jshipher',
  [
    `{"markdown":"JP Shipherd assigned existing Jira Task: **Test Task -- please ignore -- to be deleted** to you.\\n\\n>Description:[~jalumbau], [~hadougla], just confirming that you are getting notifications from the Jira bot.   Let me know or at mention me in a comment.<br /> <br />I will add you and [~shraban] as watchers to this ticket in an effort to understand how Jira exposes watchers in its webhooks\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARK-7329"}`,
  ]));

/* A ticket is created with mentions in the description */
testCases.push(new TestCase('./jira-event-test-cases/1522768424337-jira:issue_created-issue_created.json',
  'creates', 'jshipher', 'an unassigned ticket',
  [
    '', '',  // Two users mentioned in description don't have bots
    `{"markdown":"JP Shipherd created a Jira Task: **Test Task -- please ignore -- to be deleted** and mentioned to you in it.\\n\\n>Description:[~jalumbau], [~hadougla], just confirming that you are getting notifications from the Jira bot.   Let me know or at mention me in a comment.<br /> <br />I will add you and [~shraban] as watchers to this ticket in an effort to understand how Jira exposes watchers in its webhooks\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARK-7329"}`
  ]));

/* assign an existing ticket to someone using the bot */
/* This is one of our "special users" not using a cisco email address in jira */
testCases.push(new TestCase('./jira-event-test-cases/jp-assigns-ralf-issue_updated.json',
  'assigns to', 'jshipher', 'raschiff',
  [
    `{"markdown":"JP Shipherd assigned existing Jira Task: **Test issue -- ignore** to you.\\n\\n>Description:Please delete this later. [~jshipher]\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARKPLAN-360"}`
  ]));

/* @mention multiple people who are all using the bot */
testCases.push(new TestCase('./jira-event-test-cases/jp-comments-to-ralf-krisboone-issue_commented.json',
  'comments mentioning', 'jshipher', 'raschiff and kboone',
  [
    `{"markdown":"JP Shipherd mentioned you in the Jira Task: **Hopefully the last test ticket for JP**\\n\\n>[~raschiff].    Thanks for your help with all my tickets today.   I'm making a Jira Notifier bot that lets me know immediately when someone assigns a ticket to me or mentions me in the comments or description.   Let me know if you are interested in trying it. [~kboone]\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/TROPO-11576"}`,
    `{"markdown":"JP Shipherd mentioned you in the Jira Task: **Hopefully the last test ticket for JP**\\n\\n>[~raschiff].    Thanks for your help with all my tickets today.   I'm making a Jira Notifier bot that lets me know immediately when someone assigns a ticket to me or mentions me in the comments or description.   Let me know if you are interested in trying it. [~kboone]\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/TROPO-11576"}`
  ]));

/* @mention multiple people only one of whom is using the bot */
testCases.push(new TestCase('./jira-event-test-cases/jp-comments-to-ralf-nobody1-issue_commented.json',
  'comments mentioning', 'jshipher', 'raschiff and nobody1',
  [
    '',
    `{"markdown":"JP Shipherd mentioned you in the Jira Task: **Hopefully the last test ticket for JP**\\n\\n>[~raschiff].    Thanks for your help with all my tickets today.   I'm making a Jira Notifier bot that lets me know immediately when someone assigns a ticket to me or mentions me in the comments or description.   Let me know if you are interested in trying it. [~nobody1]\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/TROPO-11576"}`
  ]));

/* User using the bot assigns a ticket to themselves */                
testCases.push(new TestCase('./jira-event-test-cases/jp-assigns-jp-issue_updated.json',
  'assigns to', 'jshipher', 'jshipher',
  [
    `{"markdown":"JP Shipherd assigned existing Jira Task: **Test issue -- ignore** to you.\\n\\n>Description:Please delete this later. [~jshipher]\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARKPLAN-360"}`
  ]));

/* New comment that @mentions a user using the bot and one that isnt */
testCases.push(new TestCase('./jira-event-test-cases/jp-comments-to-jp-issue_commented.json',
  'comments mentioning', 'jshipher', 'medash',
  [
    '',
    `{"markdown":"JP Shipherd mentioned you in the Jira Task: **Hopefully the last test ticket for JP**\\n\\n>[~raschiff].    Thanks for your help with all my tickets today.   I'm making a Jira Notifier bot that lets me know immediately when someone assigns a ticket to me or mentions me in the comments or description.   Let me know if you are interested in trying it. [~medash]\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/TROPO-11576"}`
  ]));

/* An updated comment @mentions a user using the bot */                
testCases.push(new TestCase('./jira-event-test-cases/jp-updates-comment-to-jp-issue_comment_edited.json',
  'comments mentioning', 'jshipher', 'jshipher',
  [
    `{"markdown":"JP Shipherd mentioned you in the Jira Task: **Test issue -- ignore**\\n\\n>C'mon [~jshipher] what are you waiting for?  Changing this to create an comment updated event.\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARKPLAN-360"}`
  ]));

/* A ticket is deleted that was assigned to a bot user */
testCases.push(new TestCase('./jira-event-test-cases/liz-deletes-jps-issue_deleted.json',
  'deletes ticket assigned to', 'lizlau', 'jshipher',
  [
    `{"markdown":"Liz Laub deleted a Jira Task: **Test Issue #2** that was assigned to you.\\n\\n>Description:[~lizlau] will delete this soon.\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARKPLAN-368"}`
  ]));

/* User updates description of ticket mentioning a user using the bot */
testCases.push(new TestCase('./jira-event-test-cases/jp-updated-description-issue_updated.json',
  'updates description mentioning', 'jshipher', 'jshipher',
  [
    `{"markdown":"JP Shipherd updated the description of Jira Task: **Test issue -- ignore** to you.\\n\\n>Description:Please delete this later. [~jshipher].  Actually it looks like you will need to ask someone else to do this since you can;t.\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARKPLAN-360"}`
  ]));

/* User creates a new ticket and assigns it a bot user */                
testCases.push(new TestCase('./jira-event-test-cases/jp-creates-for-ralf-issue_created.json',
  'creates ticket for', 'jshipher', 'raschiff',
  [
    `{"markdown":"JP Shipherd created a Jira Task: **Test Issue #2** and assigned it to you.\\n\\n>Description:[~lizlau] will delete this soon.\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARKPLAN-368"}`,
    `{"markdown":"JP Shipherd created a Jira Task: **Test Issue #2** and mentioned to you in it.\\n\\n>Description:[~lizlau] will delete this soon.\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARKPLAN-368"}`
  ]));

/* Ignore a description update when no NEW text was added to the description */
testCases.push(new TestCase('./jira-event-test-cases/eivhaarr-removes-text-from-description-issue_updated.json',
  'updates and mentions', 'eivhaarr', 'pmadai',
  ['']));

testCases.push(new TestCase('./jira-event-test-cases/1522952583499-jira:issue_updated-issue_commented.json',
  'comments', 'jshipher', 'without any mentions',
  [
    '', '',   // There are two mentioned people not using the bot
    `{"markdown":"JP Shipherd mentioned you in the Jira Task: **Test Task -- please ignore -- to be deleted**\\n\\n>Testing behavior when a new notification WITH mentions is added to a ticket with watchers.<br /> <br />[~jalumbau], [~shraban], [~hadougla] note that I'm testing this in my own dev environment at the moment.  You won't see updates from the bot until I push it to deployment.   Will post when that happens.\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARK-7329"}`,
    `{"markdown":"JP Shipherd commented on a Jira Task: **Test Task -- please ignore -- to be deleted** that you are watching.\\n\\n>Testing behavior when a new notification WITH mentions is added to a ticket with watchers.<br /> <br />[~jalumbau], [~shraban], [~hadougla] note that I'm testing this in my own dev environment at the moment.  You won't see updates from the bot until I push it to deployment.   Will post when that happens.\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARK-7329"}`
  ]));

/* A ticket with watchers (one using the bot) gets a new comment (without any mentions) */
testCases.push(new TestCase('./jira-event-test-cases/1522952365307-jira:issue_updated-issue_commented.json',
  'comments', 'jshipher', 'without any mentions',
  [
    `{"markdown":"JP Shipherd commented on a Jira Task: **Test Task -- please ignore -- to be deleted** that you are watching.\\n\\n>Testing behavior when a new notification without mentions is added to a ticket with watchers.\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARK-7329"}`
  ]));

/* A ticket is assigned with mentions in the description */
testCases.push(new TestCase('./jira-event-test-cases/issue_update-issue_assigned_to_jp.json',
  'assigns to', 'jshipher', 'jshipher',
  [
    `{"markdown":"JP Shipherd assigned existing Jira Task: **Test Task -- please ignore -- to be deleted** to you.\\n\\n>Description:[~jalumbau], [~hadougla], just confirming that you are getting notifications from the Jira bot.   Let me know or at mention me in a comment.<br /> <br />I will add you and [~shraban] as watchers to this ticket in an effort to understand how Jira exposes watchers in its webhooks\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARK-7329"}`
  ]));
  
/* A ticket is created with mentions in the description */
testCases.push(new TestCase('./jira-event-test-cases/1522768424337-jira:issue_created-issue_created.json',
  'creates', 'jshipher', 'an unassigned ticket',
  [
    '', '',  // Two users mentioned in description don't have bots
    `{"markdown":"JP Shipherd created a Jira Task: **Test Task -- please ignore -- to be deleted** and mentioned to you in it.\\n\\n>Description:[~jalumbau], [~hadougla], just confirming that you are getting notifications from the Jira bot.   Let me know or at mention me in a comment.<br /> <br />I will add you and [~shraban] as watchers to this ticket in an effort to understand how Jira exposes watchers in its webhooks\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARK-7329"}`
  ]));

/* The status of ticket with watchers using the bot was updated */
/* No change to assignments or mentions so only watchers (one using the bot) are notified */
testCases.push(new TestCase('./jira-event-test-cases/1522768650390-jira:issue_updated-issue_generic.json',
  'changes', 'jshipher', 'status',
  ['',  // No assignees or @mentions generate update
  // Watcher updates:
    `{"markdown":"JP Shipherd updated a Jira Task: **Test Task -- please ignore -- to be deleted** that you are watching.\\n\\n>updated field:status from:\\"New\\" to:\\"In Progress\\"\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARK-7329"}`,
  ]));

/* assign an existing ticket to someone using the bot */
/* This is one of our "special users" not using a cisco email address in jira */
testCases.push(new TestCase('./jira-event-test-cases/jp-assigns-ralf-issue_updated.json',
  'assigns to', 'jshipher', 'raschiff',
  [
    `{"markdown":"JP Shipherd assigned existing Jira Task: **Test issue -- ignore** to you.\\n\\n>Description:Please delete this later. [~jshipher]\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARKPLAN-360"}`
  ]));

/* @mention multiple people who are not using the bot */
testCases.push(new TestCase('./jira-event-test-cases/jp-comments-to-non-bot-users-issue_commented.json',
  'comments mentioning', 'jshipher', 'nobody1 and nobody2',
  ['', '']));

/* An updated comment @mentions a user using the bot */                
testCases.push(new TestCase('./jira-event-test-cases/jp-updates-comment-to-jp-issue_comment_edited.json',
  'comments mentioning', 'jshipher', 'jshipher',
  [
    `{"markdown":"JP Shipherd mentioned you in the Jira Task: **Test issue -- ignore**\\n\\n>C'mon [~jshipher] what are you waiting for?  Changing this to create an comment updated event.\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARKPLAN-360"}`
  ]));

/* Process a multi-line comment correctly */
testCases.push(new TestCase('./jira-event-test-cases/1523460120955-jira:issue_updated-issue_comment_edited.json',
  'updates and mentions', 'jshipher', 'jsoliman',
  [
    '',  // nobody with a bot is assigned or mentioned in the description of this ticket
    `{"markdown":"JP Shipherd uppdated a comment on a Jira Task: **Create analysis tool and use it to compare & analyzing pricing api results from middleware and PAPI** that you are watching.\\n\\n>Hi [~jsoliman], I suspect a lot of these differences will go away if you point to the same Billwise instance.   The easiest thing to do is probably have you point your test system to the production instance of billwise.  I have read only access credentials that I can share with you if you ping me on Spark.   Talk to Hancheng and make sure he's OK with that.  If suspect this will make 90% of the differences go away.<br />If you are strongly against pointing to production billwise, I can help you spin up a local instance of the middleware talking to whatever instance of BW you are talking to.   With that said, I think production is better since if there are differences in the data (which their obviously are), there might be a problem that we don't catch.  Either way just ping me on Spark and we'll come up with a plan.<br />Thanks for doing this!\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/TROPO-13333"}`,
    `{"markdown":"JP Shipherd uppdated a comment on a Jira Task: **Create analysis tool and use it to compare & analyzing pricing api results from middleware and PAPI** that you are watching.\\n\\n>Hi [~jsoliman], I suspect a lot of these differences will go away if you point to the same Billwise instance.   The easiest thing to do is probably have you point your test system to the production instance of billwise.  I have read only access credentials that I can share with you if you ping me on Spark.   Talk to Hancheng and make sure he's OK with that.  If suspect this will make 90% of the differences go away.<br />If you are strongly against pointing to production billwise, I can help you spin up a local instance of the middleware talking to whatever instance of BW you are talking to.   With that said, I think production is better since if there are differences in the data (which their obviously are), there might be a problem that we don't catch.  Either way just ping me on Spark and we'll come up with a plan.<br />Thanks for doing this!\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/TROPO-13333"}`
  ]));

/* Create a new ticket and assign it to a bot user */
testCases.push(new TestCase('./jira-event-test-cases/1523584338774-jira:issue_created-issue_created.json',
  'creates and assigns', 'jshipher', 'jshipher',
  [
    `{"markdown":"JP Shipherd created a Jira Task: **Testing 3** and assigned it to you.\\n\\n>Description:Testing 3\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/OPS-9914"}`
  ]));


// Run the Tests
var verbose = false;
if (process.env.VERBOSE) {
  verbose = true;
}

// This no longer works because it depends on each test completing before the next one starts
// The new processJiraEvent does not complete the call to bot.say before the next test starts
for (var i = 0, len = testCases.length; i < len; i++) {
  test = testCases[i];
  //var jiraEvent = require(test.file);
  var jiraEvent = JSON.parse(fs.readFileSync(test.file, "utf8"));
  jiraEventHandler.processJiraEvent(jiraEvent, framework, emailOrg, checkTestResult(framework, test, i + 1));
}

function checkTestResult(framework, test, testNum) {
  return function jiraEventCallback(err, bot = null) {
    test.resultsSeen += 1;
    if (err) {
      console.error('Test %d (Result %d of %d) Failed.', testNum);
      if (verbose) {
        console.log('Got error in callback:' + err.message);
        console.log('Expected\n' + test.result[test.resultsSeen - 1]);
      }
      return;
    }

    //TODO figure out how to properly deal with this
    if (test.resultsSeen > test.result.length) {
      console.error('Got an unexpected test result for test: ' + testNum);
      if ((bot) && (bot.jiraEventMessage)) {
        console.error(bot.jiraEventMessage);
      }
      return;
    }

    if (!bot) {
      if (test.result[test.resultsSeen - 1]) {
        console.error('Test %d (Result %d of %d) Failed.', testNum, test.resultsSeen, test.result.length);
      } else {
        console.log('Test %d (Result %d of %d) Passed.  Got expected non-notification', testNum, test.resultsSeen, test.result.length);
      }
      if (verbose) {
        console.log('jiraEventHander did not callback with a bot.');
        console.log('Expected\n' + test.result[test.resultsSeen - 1]);
      }
      return;
    }
    if (verbose) {
      console.log('Checking test file:' + test.file);
      console.log(test.author + ' ' + test.action + ' ' + test.subject + '...');
    }
    var resultFound = false;
    if (bot.jiraEventMessage) {
      resultFound = true;
      // Whitespace got me down, just removed it for this comparison
      if (bot.jiraEventMessage.replace(/\s/g, '') === test.result[test.resultsSeen - 1].replace(/\s/g, '')) {
        console.log('Test %d (Result %d of %d) Passed. Got expected notification.', testNum, test.resultsSeen, test.result.length);
        //console.log(bot.jiraEventMessage);
      } else {
        console.error('Test %d (Result %d of %d) Failed.', testNum, test.resultsSeen, test.result.length);
        if (verbose) {
          console.log('Got\n' + bot.jiraEventMessage + 'Expected\n' + test.result[test.resultsSeen - 1]);
        }
      }
      bot.jiraEventMessage = '';
    }
    if (!resultFound) {
      if (!test.result) {
        console.log('Test %d (Result %d of %d) Passed.', testNum, test.resultsSeen, test.result.length);
      } else {
        console.error('Test %d (Result %d of %d) Failed.', testNum, test.resultsSeen, test.result.length);
        if (verbose) {
          console.log('Got no result');
          console.log('Expected\n' + test.result[test.resultsSeen - 1]);
        }
      }
    }
  };
}

