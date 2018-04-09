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
// For testing we'll assume we always want to the notifications
Bot.prototype.recall = function(key) {
  return new Promise(function (resolve, reject) {
    if (key === 'user_config') {
      resolve({'askedExit': false});
    } else {
      reject(console.error('Test harness got unexpected bot.recall() call with key:'+key));
    }
  });
};

// jiraEventHandler will call bot.say to send a result to a Spark user
Bot.prototype.say = function() {
  // say can take one or two args.   We only care about the second for our cannonical result
  var args = Array.prototype.slice.call(arguments);
  // determine if a format is defined in arguments
  // first and second arguments should be string type
  // first argument should be one of the valid formats
  var formatDefined = (args.length > 1 && typeof args[0] === 'string' && typeof args[1] === 'string' && _.includes(['text', 'markdown', 'html'], _.toLower(args[0])));
  // if format defined in function arguments, overide default
  if(formatDefined) {
    format = _.toLower(args.shift());
  }
  // if message is object (raw)
  if(typeof args[0] === 'object') {
    this.jiraEventMessage += JSON.stringify(args[0]) + '\n';
  } else if(typeof args[0] === 'string') {
    this.jiraEventMessage += args[0] + '\n';
  } else {
    return when.reject(new Error('Invalid function arguments'));
  }
};


// Create our own verion of the flint object that supports our test cases.
function Flint() {
  this.bots=[];
}
// jiraEventHandler calls flint.debug.   We don't care about this for our tests
Flint.prototype.debug = function(message) {
  if ((process.env.DEBUG) && (process.env.DEBUG.toLowerCase().substring('flint'))) {
    console.log(message);
  }
};
// Build the list of "bots" that we want our test suite to run against
// The current set assumes all users work for ciso
flint = new Flint();
flint.bots.push(new Bot('jshipher@cisco.com'));
flint.bots.push(new Bot('raschiff@cisco.com'));
flint.bots.push(new Bot('kboone@cisco.com'));
flint.bots.push(new Bot('lizlau@cisco.com'));
flint.bots.push(new Bot("hadougla@cisco.com"));
flint.bots.push(new Bot('hahsiung@cisco.com'));
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
  ['{"markdown":"<br>Charles Lin updated the description of a Jira Bug: **ios spark - roster list should transition to \'closed\' state when user switch back to in-meeting view** that you are watching."}\n'+
    '{"markdown":"> description changed from:\\"ios spark - roster list should be closed when user switch back to in-meeting view\\r\\n\\r\\ncurrently if you open and view the roster list, then tap the small PIP (which shows the in-meeting content) to return to the in-meeting view, the roster list is not considered to be \'closed\'.   A consequence of that is if user now wants to submit feedback, by tapping upper left corner \'minimize\' button, instead of seeing the spark main UI which shows options of \\"Message\\", \\"Teams\\", \\"Call\\", \\"Meetings\\", and \\"Me\\", you are back to seeing the opened roster list instead.\\r\\n\\r\\nNow, let\'s say user even decides to try to find/get to the Me option UI, by tapping the \'Close\' button on upper left corner of the roster list, when roster list is closed, instead of showing user the main UI with the spark app\'s main menu options at bottom, it goes back to showing the in-meeting content full screen.   So user gets the impression that it is impossible to find/get to the \'Me\' > \'Submit Feedback\' UI\\r\\n\\r\\nsee video\\r\\n\\r\\nAs a comparison, Android does not show this particular behavior, so it is always easy for user to navigate and find the Me > Submit Feedback UI\\r\\n\\", to:\\"ios spark - roster list should be closed when user switch back to in-meeting view\\r\\n\\r\\ncurrently if you open and view the roster list, then tap the small PIP (which shows the in-meeting content) to return to the in-meeting view, the roster list is not considered to be \'closed\'.   \\r\\n\\r\\nA consequence of that is user will have trouble getting back to the app main UI/main option menu when user wants to submit feedback.   If user now wants to submit feedback, by tapping upper left corner \'minimize\' button, instead of seeing the spark main UI which shows options of \\"Message\\", \\"Teams\\", \\"Call\\", \\"Meetings\\", and \\"Me\\", you are back to seeing the opened roster list instead.\\r\\n\\r\\nNow, let\'s say user even decides to try to find/get to the Me option UI, by tapping the \'Close\' button on upper left corner of the roster list, when roster list is closed, instead of showing user the main UI with the spark app\'s main menu options at bottom, it goes back to showing the in-meeting content full screen.   So user gets the impression that it is impossible to find/get to the \'Me\' > \'Submit Feedback\' UI\\r\\n\\r\\nsee video\\r\\n\\r\\nAs a comparison, Android does not show this particular behavior, so it is always easy for user to navigate and find the Me > Submit Feedback UI\\r\\n\\""}\n'+
    'https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-7645',
  '{"markdown":"<br>Charles Lin updated the description of a Jira Bug: **ios spark - roster list should transition to \'closed\' state when user switch back to in-meeting view** that you are watching."}\n'+
    '{"markdown":"> description changed from:\\"ios spark - roster list should be closed when user switch back to in-meeting view\\r\\n\\r\\ncurrently if you open and view the roster list, then tap the small PIP (which shows the in-meeting content) to return to the in-meeting view, the roster list is not considered to be \'closed\'.   A consequence of that is if user now wants to submit feedback, by tapping upper left corner \'minimize\' button, instead of seeing the spark main UI which shows options of \\"Message\\", \\"Teams\\", \\"Call\\", \\"Meetings\\", and \\"Me\\", you are back to seeing the opened roster list instead.\\r\\n\\r\\nNow, let\'s say user even decides to try to find/get to the Me option UI, by tapping the \'Close\' button on upper left corner of the roster list, when roster list is closed, instead of showing user the main UI with the spark app\'s main menu options at bottom, it goes back to showing the in-meeting content full screen.   So user gets the impression that it is impossible to find/get to the \'Me\' > \'Submit Feedback\' UI\\r\\n\\r\\nsee video\\r\\n\\r\\nAs a comparison, Android does not show this particular behavior, so it is always easy for user to navigate and find the Me > Submit Feedback UI\\r\\n\\", to:\\"ios spark - roster list should be closed when user switch back to in-meeting view\\r\\n\\r\\ncurrently if you open and view the roster list, then tap the small PIP (which shows the in-meeting content) to return to the in-meeting view, the roster list is not considered to be \'closed\'.   \\r\\n\\r\\nA consequence of that is user will have trouble getting back to the app main UI/main option menu when user wants to submit feedback.   If user now wants to submit feedback, by tapping upper left corner \'minimize\' button, instead of seeing the spark main UI which shows options of \\"Message\\", \\"Teams\\", \\"Call\\", \\"Meetings\\", and \\"Me\\", you are back to seeing the opened roster list instead.\\r\\n\\r\\nNow, let\'s say user even decides to try to find/get to the Me option UI, by tapping the \'Close\' button on upper left corner of the roster list, when roster list is closed, instead of showing user the main UI with the spark app\'s main menu options at bottom, it goes back to showing the in-meeting content full screen.   So user gets the impression that it is impossible to find/get to the \'Me\' > \'Submit Feedback\' UI\\r\\n\\r\\nsee video\\r\\n\\r\\nAs a comparison, Android does not show this particular behavior, so it is always easy for user to navigate and find the Me > Submit Feedback UI\\r\\n\\""}\n'+
    'https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-7645'], 2));

/* A ticket status was moved to resolved, only watchers are notified */
testCases.push(new TestCase('./jira-event-test-cases/1522969922819-jira:issue_updated-issue_resolved.json',
  'changed resolution to', 'hahsiung', 'resolved',
  ['',
    '{"markdown":"<br>Hancheng Hsiung updated the resolution field in a Jira Bug: **Failed the api call to addservice for short code number due to new logic for \\"pricingPrefix\\"** that you are watching."}\n'+
    '{"markdown":"> resolution changed to:\\"Fixed\\""}\n'+
    'https://jira-eng-gpk2.cisco.com/jira/browse/TROPO-13320',
    '{"markdown":"<br>Hancheng Hsiung updated the resolution field in a Jira Bug: **Failed the api call to addservice for short code number due to new logic for \\"pricingPrefix\\"** that you are watching."}\n'+
    '{"markdown":"> resolution changed to:\\"Fixed\\""}\n'+
    'https://jira-eng-gpk2.cisco.com/jira/browse/TROPO-13320'], 2));

/* A ticket was moved to the work started state and assigned to a bot user */
testCases.push(new TestCase('./jira-event-test-cases/1522969913206-jira:issue_updated-issue_work_started.json',
  'assigns to', 'hahsiung', 'hahsiung',
  ['{"markdown":"<br>Hancheng Hsiung assigned existing Jira Bug: **Failed the api call to addservice for short code number due to new logic for \\"pricingPrefix\\"** to you."}\n'+
    '{"markdown":"> Description:Hi Mike and Wing,\\r\\n\\r\\n I was running some regression tests today on QA CCS2 system (15.12.04 \\"buildDate\\": \\"2018-02-22 16:27:36\\") and the following 3 tests failed when calling BW’s “addservice” api.\\r\\n\\r\\nPossible config error or bug relating to “pricingPrefix” value?\\r\\n\\r\\nMy understanding from Sanjiv is that for Shortcodes, BW will still look up the plan using numeric instead of xx:x:x format, or did I misunderstand? Thx. -Joanne\\r\\n\\r\\n \\r\\n\\r\\n+Tests and log snippets:+\\r\\n\\r\\nTest 1 – Short Code Normal\\r\\n\\r\\nMar 29 03:48:22.168 INFO  localhost PRISM 9410///017dd982-fbc8-4bdc-ba9c-b131fca22f3c/1/[] [http-0.0.0.0-8080-exec-16] Billwise response: \\\\{\\"success\\":false,\\"requestId\\":203372602,\\"message\\":\\"Failure\\",\\"datasetId\\":\\"290\\",\\"companyCd\\":\\"290\\",\\"customerCd\\":\\"011301\\",\\"packageCd\\":\\"SC01\\",\\"servicePoolCd\\":\\"000\\",\\"salesAgentCd\\":\\"000001\\",\\"effectiveDate\\":\\"2018-03-29T03:48:22Z\\",\\"reasonCd\\":\\"A\\",\\"updateSwitch\\":true,\\"switchCd\\":\\"290\\",\\"serviceId\\":\\"N000000000007660\\",\\"alternateServiceId\\":\\"19513000004\\",\\"pricingPrefix\\":\\"US:G:B\\",\\"rateElementType\\":30,\\"errors\\":[{\\"field\\":\\"pricingPrefix\\",\\"value\\":\\"US:G:B\\",\\"errorCode\\":\\"apiAddServiceCommand.pricingPrefix.missingRecurringAmount.error\\"}]}\\r\\n\\r\\n \\r\\n\\r\\nTest2 – Short Code Shared\\r\\n\\r\\nMar 29 03:48:22.660 INFO  localhost PRISM 9410///8bb0a79a-d4b1-4c91-bb97-72aca241c453/1/[] [http-0.0.0.0-8080-exec-23] Billwise response: \\\\{\\"success\\":false,\\"requestId\\":203372603,\\"message\\":\\"Failure\\",\\"datasetId\\":\\"290\\",\\"companyCd\\":\\"290\\",\\"customerCd\\":\\"011301\\",\\"packageCd\\":\\"SS01\\",\\"servicePoolCd\\":\\"000\\",\\"salesAgentCd\\":\\"000001\\",\\"effectiveDate\\":\\"2018-03-29T03:48:22Z\\",\\"reasonCd\\":\\"A\\",\\"updateSwitch\\":true,\\"switchCd\\":\\"290\\",\\"serviceId\\":\\"N000000000007661\\",\\"alternateServiceId\\":\\"19515000004\\",\\"pricingPrefix\\":\\"US:G:S\\",\\"rateElementType\\":37,\\"errors\\":[{\\"field\\":\\"pricingPrefix\\",\\"value\\":\\"US:G:S\\",\\"errorCode\\":\\"apiAddServiceCommand.pricingPrefix.missingRecurringAmount.error\\"}]}\\r\\n\\r\\n \\r\\n\\r\\nTest3 – this is a customer owned number\\r\\n\\r\\nMar 29 03:48:24.067 INFO  localhost PRISM 9410///d5832114-1e28-4be4-8053-b3e80c3f1ed2/1/[] [http-0.0.0.0-8080-exec-30] Billwise response: {\\"success\\":false,\\"requestId\\":203372609,\\"message\\":\\"Failure\\",\\"datasetId\\":\\"290\\",\\"companyCd\\":\\"290\\",\\"customerCd\\":\\"011301\\",\\"packageCd\\":\\"TP1A\\",\\"servicePoolCd\\":\\"000\\",\\"salesAgentCd\\":\\"000001\\",\\"effectiveDate\\":\\"2018-03-29T03:48:23Z\\",\\"reasonCd\\":\\"A\\",\\"updateSwitch\\":true,\\"switchCd\\":\\"290\\",\\"serviceId\\":\\"N000000000007663\\",\\"alternateServiceId\\":\\"19517000097\\",\\"pricingPrefix\\":\\"null:G:B\\",\\"rateElementType\\":10,\\"errors\\":[{\\"field\\":\\"pricingPrefix\\",\\"value*\\":\\"null:G:B\\",\\"*errorCode\\":\\"apiAddServiceCommand.pricingPrefix.missingRecurringAmount.error\\"}]}\\r\\n\\r\\n \\r\\n\\r\\n "}\n'+
    'https://jira-eng-gpk2.cisco.com/jira/browse/TROPO-13320'], 1));

/* A ticket with watchers gets a new comment and some watchers are mentioned */
testCases.push(new TestCase('./jira-event-test-cases/1522952583499-jira:issue_updated-issue_commented.json',
  'comments', 'jshipher', 'without any mentions',
  ['', '',   // There are two mentioned people not using the bot
    '{"markdown":"<br>JP Shipherd mentioned you in the Jira Task: **Test Task -- please ignore -- to be deleted**"}\n'+
    '{"markdown":"> Testing behavior when a new notification WITH mentions is added to a ticket with watchers.\\r\\n\\r\\n \\r\\n\\r\\n[~jalumbau], [~shraban], [~hadougla] note that I\'m testing this in my own dev environment at the moment.  You won\'t see updates from the bot until I push it to deployment.   Will post when that happens."}\n'+
    'https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-7329',
    '{"markdown":"<br>JP Shipherd commented on a Jira Task: **Test Task -- please ignore -- to be deleted** that you are watching."}\n'+
    '{"markdown":"> Testing behavior when a new notification WITH mentions is added to a ticket with watchers.\\r\\n\\r\\n \\r\\n\\r\\n[~jalumbau], [~shraban], [~hadougla] note that I\'m testing this in my own dev environment at the moment.  You won\'t see updates from the bot until I push it to deployment.   Will post when that happens."}\n'+
    'https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-7329'], 4));

/* A ticket with watchers gets a new comment (without any mentions) */
testCases.push(new TestCase('./jira-event-test-cases/1522952365307-jira:issue_updated-issue_commented.json',
  'comments', 'jshipher', 'without any mentions',
  ['{"markdown":"<br>JP Shipherd commented on a Jira Task: **Test Task -- please ignore -- to be deleted** that you are watching."}\n'+
    '{"markdown":"> Testing behavior when a new notification without mentions is added to a ticket with watchers."}\n'+
    'https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-7329',
  '{"markdown":"<br>JP Shipherd commented on a Jira Task: **Test Task -- please ignore -- to be deleted** that you are watching."}\n'+
    '{"markdown":"> Testing behavior when a new notification without mentions is added to a ticket with watchers."}\n'+
    'https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-7329'], 2));

/* A ticket is assigned with mentions in the description */
testCases.push(new TestCase('./jira-event-test-cases/issue_update-issue_assigned_to_jp.json',
  'assigns to', 'jshipher', 'jshipher',
  ['{"markdown":"<br>JP Shipherd assigned existing Jira Task: **Test Task -- please ignore -- to be deleted** to you."}\n'+
    '{"markdown":"> Description:[~jalumbau], [~hadougla], just confirming that you are getting notifications from the Jira bot.'+
    '   Let me know or at mention me in a comment.\\r\\n\\r\\n \\r\\n\\r\\nI will add you and [~shraban] as watchers to this ticket in an effort to understand how Jira exposes watchers in its webhooks"}\n'+
    'https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-7329',
  '{"markdown":"<br>JP Shipherd assigned a Jira Task: **Test Task -- please ignore -- to be deleted** that you are watching."}\n'+
    '{"markdown":"> assignee changed to:\\"JP Shipherd\\""}\n'+
    'https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-7329'], 2));
/* A ticket is created with mentions in the description */
testCases.push(new TestCase('./jira-event-test-cases/1522768424337-jira:issue_created-issue_created.json',
  'creates', 'jshipher', 'an unassigned ticket',
  ['',  // Two users mentioned in description don't have bots
    '',
    '{"markdown":"<br>JP Shipherd created a Jira Task: **Test Task -- please ignore -- to be deleted** and mentioned to you in it."}\n'+
  '{"markdown":"> Description:[~jalumbau], [~hadougla], just confirming that you are getting notifications from the Jira bot.'+
  '   Let me know or at mention me in a comment.\\r\\n\\r\\n \\r\\n\\r\\nI will add you and [~shraban] as watchers to this ticket in an effort to understand how Jira exposes watchers in its webhooks"}\n'+
  'https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-7329'], 3));
/* The status of ticket with watchers using the bot was updated */
/* No change to assignments or mentions so only watchers are notified */
testCases.push(new TestCase('./jira-event-test-cases/1522768650390-jira:issue_updated-issue_generic.json',
  'changes', 'jshipher', 'status',
  ['',  // No assignees or @mentions generate update
  // Watcher updates:
    '{"markdown":"<br>JP Shipherd updated the status of a Jira Task: **Test Task -- please ignore -- to be deleted** that you are watching."}\n' +
  '{"markdown":"> status changed from:\\"New\\", to:\\"In Progress\\""}\n'+
  'https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-7329',
    '{"markdown":"<br>JP Shipherd updated the status of a Jira Task: **Test Task -- please ignore -- to be deleted** that you are watching."}\n' +
  '{"markdown":"> status changed from:\\"New\\", to:\\"In Progress\\""}\n'+
  'https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-7329'], 3));
/* assign an existing ticket to someone using the bot */
/* This is one of our "special users" not using a cisco email address in jira */
testCases.push(new TestCase('./jira-event-test-cases/jp-assigns-ralf-issue_updated.json',
  'assigns to', 'jshipher', 'raschiff',
  ['{"markdown":"<br>JP Shipherd assigned existing Jira Task: **Test issue -- ignore** to you."}\n' +
  '{"markdown":"> Description:Please delete this later. [~jshipher]"}\n' +
  'https://jira-eng-gpk2.cisco.com/jira/browse/SPARKPLAN-360\n'], 1));
testCases.push(new TestCase('./jira-event-test-cases/jp-assigns-ralf-issue_updated.json',
  'assigns to', 'jshipher', 'raschiff',
  ['{"markdown":"<br>JP Shipherd assigned existing Jira Task: **Test issue -- ignore** to you."}\n' +
  '{"markdown":"> Description:Please delete this later. [~jshipher]"}\n' +
  'https://jira-eng-gpk2.cisco.com/jira/browse/SPARKPLAN-360\n'], 1));
/* @mention multiple people who are not using the bot */
testCases.push(new TestCase('./jira-event-test-cases/jp-comments-to-non-bot-users-issue_commented.json',
  'comments mentioning', 'jshipher', 'nobody1 and nobody2',
  ['', ''],2));
/* @mention multiple people who are all using the bot */
testCases.push(new TestCase('./jira-event-test-cases/jp-comments-to-ralf-krisboone-issue_commented.json',
  'comments mentioning', 'jshipher', 'raschiff and kboone',
  ['{"markdown":"<br>JP Shipherd mentioned you in the Jira Task: **Hopefully the last test ticket for JP**"}\n' +
  '{"markdown":"> [~raschiff].    Thanks for your help with all my tickets today.   I\'m making a Jira Notifier bot that lets me know immediately when someone assigns a ticket to me or mentions me in the comments or description.   Let me know if you are interested in trying it. [~kboone]"}\n' +
  'https://jira-eng-gpk2.cisco.com/jira/browse/TROPO-11576\n',
  '{"markdown":"<br>JP Shipherd mentioned you in the Jira Task: **Hopefully the last test ticket for JP**"}\n' +
  '{"markdown":"> [~raschiff].    Thanks for your help with all my tickets today.   I\'m making a Jira Notifier bot that lets me know immediately when someone assigns a ticket to me or mentions me in the comments or description.   Let me know if you are interested in trying it. [~kboone]"}\n' +
  'https://jira-eng-gpk2.cisco.com/jira/browse/TROPO-11576\n'],2));
/* @mention multiple people only one of whom is using the bot */
testCases.push(new TestCase('./jira-event-test-cases/jp-comments-to-ralf-nobody1-issue_commented.json',
  'comments mentioning', 'jshipher', 'raschiff and nobody1',
  ['', '{"markdown":"<br>JP Shipherd mentioned you in the Jira Task: **Hopefully the last test ticket for JP**"}\n' +
  '{"markdown":"> [~raschiff].    Thanks for your help with all my tickets today.   I\'m making a Jira Notifier bot that lets me know immediately when someone assigns a ticket to me or mentions me in the comments or description.   Let me know if you are interested in trying it. [~nobody1]"}\n' +
  'https://jira-eng-gpk2.cisco.com/jira/browse/TROPO-11576\n'], 2));
/* User using the bot assigns a ticket to themselves */                
testCases.push(new TestCase('./jira-event-test-cases/jp-assigns-jp-issue_updated.json',
  'assigns to', 'jshipher', 'jshipher',
  ['{"markdown":"<br>JP Shipherd assigned existing Jira Task: **Test issue -- ignore** to you."}\n' +
  '{"markdown":"> Description:Please delete this later. [~jshipher]"}\n' +
  'https://jira-eng-gpk2.cisco.com/jira/browse/SPARKPLAN-360\n'], 1));
/* New comment that @mentions a user using the bot */                
// testCases.push(new TestCase('./jira-event-test-cases/jp-comments-to-jp-issue_commented.json',
//                 'comments mentioning', 'jshipher', 'jshipher',
//                 ['{"markdown":"<br>JP Shipherd mentioned you in the Jira Bug: **Test Bug for JP**"}\n' +
//                 '{"markdown":">  Did you? Did you? [~jshipher], do you see this comment?"}\n' +
//                 'https://jira-eng-gpk2.cisco.com/jira/browse/TROPO-11565\n'], 1));
/* An updated comment @mentions a user using the bot */                
testCases.push(new TestCase('./jira-event-test-cases/jp-updates-comment-to-jp-issue_comment_edited.json',
  'comments mentioning', 'jshipher', 'jshipher',
  ['{"markdown":"<br>JP Shipherd mentioned you in the Jira Task: **Test issue -- ignore**"}\n' +
  '{"markdown":"> C\'mon [~jshipher] what are you waiting for?  Changing this to create an comment updated event."}\n' +
  'https://jira-eng-gpk2.cisco.com/jira/browse/SPARKPLAN-360\n'], 1));
/* A ticket is deleted that was assigned to a bot user */
testCases.push(new TestCase('./jira-event-test-cases/liz-deletes-jps-issue_deleted.json',
  'deletes ticket assigned to', 'lizlau', 'jshipher',
  ['{"markdown":"<br>Liz Laub deleted a Jira Task: **Test Issue #2** that was assigned to you."}\n' +
  '{"markdown":"> Description:[~lizlau] will delete this soon."}\n' +
  'https://jira-eng-gpk2.cisco.com/jira/browse/SPARKPLAN-368\n'], 1));
/* User updates description of ticket mentioning a user using the bot */
testCases.push(new TestCase('./jira-event-test-cases/jp-updated-description-issue_updated.json',
  'updates description mentioning', 'jshipher', 'jshipher',
  ['{"markdown":"<br>JP Shipherd updated the description of Jira Task: **Test issue -- ignore** to you."}\n' +
  '{"markdown":"> Description:Please delete this later. [~jshipher].  Actually it looks like you will need to ask someone else to do this since you can;t."}\n' +
  'https://jira-eng-gpk2.cisco.com/jira/browse/SPARKPLAN-360\n'], 1));
/* User creates a new ticket and assigns it a bot user */                
testCases.push(new TestCase('./jira-event-test-cases/jp-creates-for-ralf-issue_created.json',
  'creates ticket for', 'jshipher', 'raschiff',
  ['{"markdown":"<br>JP Shipherd created a Jira Task: **Test Issue #2** and assigned it to you."}\n' +
  '{"markdown":"> Description:[~lizlau] will delete this soon."}\n' +
  'https://jira-eng-gpk2.cisco.com/jira/browse/SPARKPLAN-368\n',
  '{"markdown":"<br>JP Shipherd created a Jira Task: **Test Issue #2** and mentioned to you in it."}\n' +
  '{"markdown":"> Description:[~lizlau] will delete this soon."}\n' +
  'https://jira-eng-gpk2.cisco.com/jira/browse/SPARKPLAN-368\n'], 2));
/* Ignore a description update when no NEW text was added to the description */
testCases.push(new TestCase('./jira-event-test-cases/eivhaarr-removes-text-from-description-issue_updated.json',
  'updates and mentions', 'eivhaarr', 'pmadai',
  [''], 1));


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
  jiraEventHandler.processJiraEvent(jiraEvent, flint, emailOrg, checkTestResult(flint, test, i+1));
}

function checkTestResult(flint, test, testNum) {
  return function jiraEventCallback(err, bot=null) {
    test.resultsSeen += 1;
    if (err) {
      console.error('Test %d (Result %d of %d) Failed.', testNum);
      if (verbose) {
        console.log('Got error in callback:'+err.message);
        console.log('Expected\n' + test.result[test.resultsSeen-1]);
      }
      return;
    }

    //TODO figure out how to properly deal with this
    if (test.resultsSeen > test.result.length) {
      console.error('Got an unexpected test result for test: '+testNum);
      if ((bot) && (bot.jiraEventMessage)) {
        console.error(bot.jiraEventMessage);
      }
      return;
    }

    if (!bot) {
      if (test.result[test.resultsSeen-1]) {
        console.error('Test %d (Result %d of %d) Failed.', testNum ,test.resultsSeen, test.result.length);
      } else {
        console.log('Test %d (Result %d of %d) Passed.  Got expected non-notification', testNum ,test.resultsSeen, test.result.length);
      }
      if (verbose) {
        console.log('jiraEventHander did not callback with a bot.');
        console.log('Expected\n' + test.result[test.resultsSeen-1]);
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
      if (bot.jiraEventMessage.replace(/\s/g, '') === test.result[test.resultsSeen-1].replace(/\s/g, '')) {
        console.log('Test %d (Result %d of %d) Passed. Got expected notification.', testNum ,test.resultsSeen, test.result.length);
        //console.log(bot.jiraEventMessage);
      } else {
        console.error('Test %d (Result %d of %d) Failed.', testNum ,test.resultsSeen, test.result.length);
        if (verbose) {
          console.log('Got\n' + bot.jiraEventMessage + 'Expected\n' + test.result[test.resultsSeen-1]);
        }
      }
      bot.jiraEventMessage = '';
    }
    if (!resultFound) {
      if (!test.result) {
        console.log('Test %d (Result %d of %d) Passed.', testNum ,test.resultsSeen, test.result.length);
      } else {
        console.error('Test %d (Result %d of %d) Failed.', testNum ,test.resultsSeen, test.result.length);
        if (verbose) {
          console.log('Got no result');
          console.log('Expected\n' + test.result[test.resultsSeen-1]);
        }
      }
    }
  };
}

