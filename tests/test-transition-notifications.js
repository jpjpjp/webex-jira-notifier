// test-transition-notifications.js
//
// Run some prepared jira event through the handler to ensure
// that we get our expected results
/*jshint esversion: 6 */  // Help out our linter

// See readme to determine how to configure test via environment
require('dotenv').config();
fs = require('fs');
var _ = require('lodash');


// SET LOG_LEVEL to enable/quiet underlying app logging
var logger = require('../logger');

// Where are the jira instance specific test cases?
const test_dir = process.env.TEST_CASE_DIR;

// Helper classes for dealing with Jira Webhook payload
const JiraConnector = require('../jira-connector');
const jira = new JiraConnector();

// boardNotifier periodically looks up and caches the keys for all stories associated
// with a board.  This environment variable specifies the cache duration
process.env.BOARD_STORY_CACHE_TIMEOUT = 5*60000;
// This environment is specific to the test framework. 
// Its a timeout for giving up on the initial bots loading their boards
// Depending on how many stories a board has, board loading can take several minutes
let promiseTimeout = (process.env.TRANSITION_TEST_INIT_TIMEOUT) ? 
  process.env.TRANSITION_TEST_INIT_TIMEOUT : 60*1000;

// Check if any of the group notifications tests are disabled
if (process.env.ENABLE_BOARD_TRANSITION_NOTIFICATIONS === 'false') {
  delete process.env.ENABLE_BOARD_TRANSITION_NOTIFICATIONS;
} else {
  // Turn on Board Transition Notifications
  process.env.ENABLE_BOARD_TRANSITION_NOTIFICATIONS = true;
}
if (process.env.ENABLE_NEW_ISSUE_NOTIFICATIONS === 'false') {
  delete process.env.ENABLE_NEW_ISSUE_NOTIFICATIONS;
} else {
  // Turn on New Issue Notifications by default
  process.env.ENABLE_NEW_ISSUE_NOTIFICATIONS = true;
}

// Pass minimal security check when giving out jira info in group spaces
let frameworkConfig = {
  restrictedToEmailDomains: 'This must be set or the group notfications will fail'
};


// Create the groupNotfier class which will create a boardNotifications object
let groupNotifier = initGroupNotifier();

// JiraEventHandler processes all events, for 1-1 and group spaces
const JiraEventHandler = require("../jira-event.js");
const jiraEventHandler = new JiraEventHandler(jira, groupNotifier);

// Set VERBOSE=true to get test logging
var verbose = false;
if (process.env.VERBOSE) {
  verbose = true;
}
var myConsole = {};
myConsole.log = function(msg) {
  if (verbose) {console.log(msg);}
}; 

// May or may not need these
// const JiraEventHandler = require("./jira-event.js");
// const jiraEventHandler = new JiraEventHandler(jiraConnector);
// fs = require('fs');

// Initially just testing the startup
// Not sending any events yet...
// if (!process.env.TEST_CASE_DIR) {
//   console.error('The environment variable TEST_CASE_DIR must be specified.');
//   process.exit(-1);
// }
// const test_dir = process.env.TEST_CASE_DIR;

// const JiraTestCases = require(`./${test_dir}/init-test-cases.js`);
// const jiraTestCases = new JiraTestCases;

// Create our own verion of the Framework object that supports our test cases.
function Framework() {
  this.bots = [];
}
// jiraEventHandler calls framework.debug.   We don't care about this for our tests
Framework.prototype.debug = function (message) {
  if ((process.env.DEBUG) && (process.env.DEBUG.toLowerCase().substring('framework'))) {
    myConsole.log(message);
  }
};

// Create our own verion of the bot objects that supports our test cases.
let botIdCounter = 1;
let roomIdCounter = 1;
function Bot(title) {
  this.isDirect = false;
  this.id = `BOT_ID_${botIdCounter++}`;
  this.room = {
    id: `ROOM_ID_${roomIdCounter++}`,
    title
  };
  this.jiraEventMessage = '';
  this.config = {
    boards: [],
    newIssueNotificationConfig: []
  };
}

let TEST_MESSAGE_ID_FOR_MESSAGE = 'Fake Message Id for a message';
// Handle any requests for bots to message rooms by logging to console
// // jiraEventHandler will call bot.say to send a result to a Spark user
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
    return Promise.reject(new Error('Invalid function arguments'));
  }
  return Promise.resolve({
    id: TEST_MESSAGE_ID_FOR_MESSAGE,
    roomId: this.room.id,
    markdown: this.jiraEventMessage, 
  });
};


// For test cases just treat replies as a regular message from the
Bot.prototype.reply = function (parentId, msg) {
  return this.say(msg);
};

// For test cases just log card data in verbose mode
Bot.prototype.sendCard = function (card) {
  if (verbose) {
    console.log(`Bot in space ${this.room.title} sent card:`);
    console.log(JSON.stringify(card, null, 2));
  }
  return Promise.resolve({
    messageId: TEST_MESSAGE_ID_FOR_CARD,
    roomId: this.room.id,
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      content: card
    }] 
  });
};

// For test cases emulate storage of bot's config 
Bot.prototype.store = function (storageId, config) {
  if (storageId === "groupSpaceConfig") {
    this.config = config;
  } else if (storageId === 'activeCardMessageId') {
    this.activeCardMessageId = config;
  } else if (storageId === 'lastNotifiedIssue') {
    this.lastNotifiedIssue = config;
  } else {
    return Promise.reject(new Error(`bot.recall: Unexpected storageId: ${storageId}`));
  }
  return Promise.resolve(config);
};

let TEST_MESSAGE_ID_FOR_CARD = 'Fake Message Id for a card';
// For test cases lets always find an actviteCardMessageId
Bot.prototype.recall = function (storageId) {
  if (storageId === "activeCardMessageId") {
    if (this.activeCardMessageId) {
      return Promise.resolve(this.activeCardMessageId);
    } else {
      return Promise.resolve(TEST_MESSAGE_ID_FOR_CARD);
    }
  } else if (storageId === "groupSpaceConfig") {
    return Promise.resolve(this.config);
  } else {
    return Promise.reject(new Error(`bot.recall: Unexpected storageId: ${storageId}`));
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

// Create some bots for our tests
let bot1 = new Bot('One board by id');
let bot2 = new Bot('Same board as first by url plus one more');
let bot3 = new Bot('A third board plus invalid ids');

// Initialize the "framework" that is passed to the notification handler
let framework = new Framework();
framework.bots = [bot1, bot2, bot3];

// Configure the various types of notifications for the bots
var initTestCases =[];
if (process.env.ENABLE_BOARD_TRANSITION_NOTIFICATIONS) {
  initTestCases.push(new InitTestCase('bot1 adds boardId 4263', bot1, '4263', 'board', 'resolve', '[Buttons and Cards] Bugs and feedback '));
  initTestCases.push(new InitTestCase('bot1 adds filterId 34567', bot1, '34567', 'filter', 'resolve', 'JP Filter for Status Change Tests'));
  initTestCases.push(new InitTestCase('bot2 adds boardId 4263 by web url', bot2, 'https://jira-eng-gpk2.cisco.com/jira/secure/RapidBoard.jspa?rapidView=4263', null, 'resolve', '[Buttons and Cards] Bugs and feedback '));
  initTestCases.push(new InitTestCase('bot2 adds boardId 2885', bot2, '2885', 'board', 'resolve', 'Webex SMB Transition Review'));
  initTestCases.push(new InitTestCase('bot2 adds filterId 34567 by url', bot2, 'https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-138557?filter=34567', 'filter', 'resolve', 'JP Filter for Status Change Tests'));
  initTestCases.push(new InitTestCase('bot3 adds boardId 4289', bot3, '4289', 'board', 'resolve', '(AX) App Experience, Shared and Foundation'));
  initTestCases.push(new InitTestCase('bot3 adds boardId 428999', bot3, '428999', 'board', 'reject', 'Unable to find board 428999\n' +
  'Make sure to specify the correct board/filter type and ensure permissions allow view access to all jira users.'));
  initTestCases.push(new InitTestCase('bot3 adds board via bad jira url', bot3, 'https://jira-foo.foobar.com/jira/secure/RapidBoard.jspa?rapidView=4263', null, 'reject', 'Could not find a board or filter matching https://jira-foo.foobar.com/jira/secure/RapidBoard.jspa?rapidView=4263'));
  initTestCases.push(new InitTestCase('bot3 adds board via bad board url', bot3, 'https://jira-eng-gpk2.cisco.com/jira/secure/SlowBoard.jspa?rapidView=4263', null, 'reject', 'Could not find a board or filter matching https://jira-eng-gpk2.cisco.com/jira/secure/SlowBoard.jspa?rapidView=4263'));
  initTestCases.push(new InitTestCase('bot3 adds board via bad board id query param', bot3, 'https://jira-eng-gpk2.cisco.com/jira/secure/RapidBoard.jspa?rapidView=NameInsteadOfNumber', null, 'reject', 'Could not find a board or filter matching https://jira-eng-gpk2.cisco.com/jira/secure/RapidBoard.jspa?rapidView=NameInsteadOfNumber'));
  initTestCases.push(new InitTestCase('bot3 adds filterId 34567 but says its a board', bot3, '34567', 'board', 'reject', `Unable to find board 34567\n` +
  `Make sure to specify the correct board/filter type and ensure permissions allow view access to all jira users.`));
  initTestCases.push(new InitTestCase('bot3 adds filter that bot jira act cant see', bot3, '35071', 'filter', 'reject', 'Unable to find filter 35071\n' +
  'Make sure to specify the correct board/filter type and ensure permissions allow view access to all jira users.'));
  initTestCases.push(new InitTestCase('bot3 adds filter that includes a project the jira act cant access', bot3, '35089', 'filter', 'reject', 'Unable to see issues associated with filter 35089\n' +
  'Post a message in the [Ask JiraNotification Bot space](https://eurl.io/#Hy4f7zOjG) to get info about the accounts your Jira administrator will need to provide view access to.')); 
}
if (process.env.ENABLE_NEW_ISSUE_NOTIFICATIONS) {
  initTestCases.push(new InitTestCase('bot1 adds filterId 34962 for new Issues', bot1, '34962', 'filter', 'resolve', 'JP\'s SDK Triage Filter for Jira Notifier Tests'));
  initTestCases.push(new InitTestCase('bot1 adds filterId 29848 for new Issues', bot1, '29848', 'filter', 'resolve', 'Filter for [Buttons and Cards] Bugs and feedback '));
  initTestCases.push(new InitTestCase('bot2 adds filterId 34962 by url for new Issues', bot2, 'https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-175917?filter=34962', 'filter', 'resolve', 'JP\'s SDK Triage Filter for Jira Notifier Tests'));
  initTestCases.push(new InitTestCase('bot3 adds a bad filter for new issues', bot3, '1234', 'filter', 'reject', 'Unable to find filter 1234\n' +
  'Make sure to specify the correct board/filter type and ensure permissions allow view access to all jira users.'));
}

// Mock trigger with attachmentAction to emulate a button press to delete a board
let deleteBoardButtonPressTrigger = {
  attachmentAction: {
    messageId: TEST_MESSAGE_ID_FOR_CARD,
    inputs: {
      requestedTask: "updateBoardConfig",
      boardsToDelete: "4263:board,2885:board,34567:filter"
    }
  }
};

// Build the list of init test objects.
function InitTestCase(description, bot, listIdOrUrl, listType, expectedPromise, expectedTitleOrError) {
  this.description = description;
  this.bot = bot;
  this.listIdOrUrl = listIdOrUrl;
  this.listType = listType;
  this.expectedPromise = expectedPromise;
  this.expectedTitleOrError = expectedTitleOrError;
}

// Build the list of cannonical jira event test objects.
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



var notifyTestCases =[];
initNotifyTestCases(notifyTestCases);

runInitTestCases(initTestCases, groupNotifier)
  .then(() => {
    if (process.env.TEST_CACHE_UPDATE_LOGIC) {
      return groupNotifier.boardTransitions.updateStoriesForBoards(
        groupNotifier.boardTransitions.boardsInfo
      );
    } else {
      return Promise.resolve();
    }
  })
  .then(() => {
    console.log('Ready to start notifying!');
    return runTests(notifyTestCases, test_dir, jira, groupNotifier);
  })
  // Emulate a button press to delete all boards from bot2
  .then(() => {
    console.log('Removing watched boards for one test bot.');
    return groupNotifier.processAttachmentAction(bot2, deleteBoardButtonPressTrigger);
  })
  .then(() => {
    notifyTestCases = [];
    initPostDeleteNotifyTestCases(notifyTestCases);
    console.log('Running notification tests again.');
    return runTests(notifyTestCases, test_dir, jira, groupNotifier); 
  })
  // TODO add another option rerun of the tests after the cache has been updated.
  .catch(e => {
    console.log(`runInitTestCases failed: ${e.message}`);
    process.exit(-1);
  });

function initNotifyTestCases(testCases) {
  if (process.env.ENABLE_BOARD_TRANSITION_NOTIFICATIONS) {
  //Transition on Buttons and Cards Board 4263
    testCases.push(new TestCase(`${test_dir}/jira_issue_updated-transition_buttons_and_cards_bug_board-manual-edit.json`,
      'changed', 'Edel Joyce', 'status',
      [
        '', '', '', '', '', '',// nobody with a bot is assigned or mentioned in the description of this ticket
        `{"markdown":"Edel Joyce transitioned a(n) Epic from Definition to Delivery:\\n* [SPARK-150410](https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-150410): Adding Webex Community to help menu\\n* Components: Client: Android, Client: Desktop (Windows and MacOS), Client: iOS, Client: Web\\n* Team/PT: Webex Growth\\n\\nWhich matches the filter: [JP Filter for Status Change Tests](https://jira-eng-gpk2.cisco.com/jira/issues/?filter=34567)"}`,
        `{"markdown":"Edel Joyce transitioned a(n) Epic from Definition to Delivery:\\n* [SPARK-150410](https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-150410): Adding Webex Community to help menu\\n* Components: Client: Android, Client: Desktop (Windows and MacOS), Client: iOS, Client: Web\\n* Team/PT: Webex Growth\\n\\nWhich matches the filter: [JP Filter for Status Change Tests](https://jira-eng-gpk2.cisco.com/jira/issues/?filter=34567)"}`,
        `{"markdown":"Edel Joyce transitioned a(n) Epic from Definition to Delivery:\\n* [SPARK-150410](https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-150410): Adding Webex Community to help menu\\n   * Components: Client: Android, Client: Desktop (Windows and MacOS), Client: iOS, Client: Web\\n   * Team/PT: Webex Growth\\n\\nWhich matches the filter: [Filter for [Buttons and Cards] Bugs and feedback ](https://jira-eng-gpk2.cisco.com/jira/issues/?filter=29848)"}`,
        `{"markdown":"Edel Joyce transitioned a(n) Epic from Definition to Delivery:\\n* [SPARK-150410](https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-150410): Adding Webex Community to help menu\\n* Components: Client: Android, Client: Desktop (Windows and MacOS), Client: iOS, Client: Web\\n* Team/PT: Webex Growth\\n\\nOn the board[[Buttons and Cards] Bugs and feedback ](https://jira-eng-gpk2.cisco.com/jira/secure/RapidBoard.jspa?rapidView=4263)"}`,
        `{"markdown":"Edel Joyce transitioned a(n) Epic from Definition to Delivery:\\n* [SPARK-150410](https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-150410): Adding Webex Community to help menu\\n* Components: Client: Android, Client: Desktop (Windows and MacOS), Client: iOS, Client: Web\\n* Team/PT: Webex Growth\\n\\nOn the board[[Buttons and Cards] Bugs and feedback ](https://jira-eng-gpk2.cisco.com/jira/secure/RapidBoard.jspa?rapidView=4263)"}`
      ]));         

    // Transition on JP Custom filter 34567
    testCases.push(new TestCase(`${test_dir}/issue_updated-action_status_change-type_feature_portfolio.json`,
      'changed', 'JP Shipherd', 'status',
      [
        '', // nobody with a bot is assigned or mentioned in the description of this ticket
        `{"markdown":"JP Shipherd transitioned a(n) Portfolio Feature from WORK STARTED to INTERNAL EARLY ACCESS:\\n* [SPARK-138557](https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-138557): Contact Center API\\n\\n* Team/PT: Developer Experience: API Innovations\\n\\nWhich matches the filter: [JP Filter for Status Change Tests](https://jira-eng-gpk2.cisco.com/jira/issues/?filter=34567)"}`,
        `{"markdown":"JP Shipherd transitioned a(n) Portfolio Feature from WORK STARTED to INTERNAL EARLY ACCESS:\\n* [SPARK-138557](https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-138557): Contact Center API\\n\\n* Team/PT: Developer Experience: API Innovations\\n\\nWhich matches the filter: [JP Filter for Status Change Tests](https://jira-eng-gpk2.cisco.com/jira/issues/?filter=34567)"}`
      ]));         
    
    // Transition on JP Custom filter 34567
    testCases.push(new TestCase(`${test_dir}/jira_issue_updated-action_resolved.json`,
      'changed', 'Prema Rao', 'status',
      [
        '', // nobody with a bot is assigned or mentioned in the description of this ticket
        `{"markdown":"Prema Rao transitioned a(n) Epic from Delivery to Done, Resolution:Resolved:\\n* [SPARK-137296](https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-137296): Traffic Shaping for Client Upgrade\\n* Components: Service: Client Upgrade\\n\\nWhich matches the filter: [JP Filter for Status Change Tests](https://jira-eng-gpk2.cisco.com/jira/issues/?filter=34567)"}`,
        `{"markdown":"Prema Rao transitioned a(n) Epic from Delivery to Done, Resolution:Resolved:\\n* [SPARK-137296](https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-137296): Traffic Shaping for Client Upgrade\\n* Components: Service: Client Upgrade\\n\\nWhich matches the filter: [JP Filter for Status Change Tests](https://jira-eng-gpk2.cisco.com/jira/issues/?filter=34567)"}`
      ]));         
  }

  if (process.env.ENABLE_NEW_ISSUE_NOTIFICATIONS) {
    //New issue on the JSSDK Triage Board
    testCases.push(new TestCase(`${test_dir}/issue_created-bug_jssdk.json`,
      'created', 'JP', 'status',
      [
        `{"markdown":"JP Shipherd created a Jira Bug: **Test Bug -- feel free to ignore or close**.\\n\\nThis is a bug created to test if the JiraNotifier will post a message about this bug being created in spaces that are configured for it.\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARK-144293"}`,
        `{"markdown":"JP Shipherd created a Jira Bug: **Test Bug -- feel free to ignore or close**.\\n\\nThis is a bug created to test if the JiraNotifier will post a message about this bug being created in spaces that are configured for it.\\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARK-144293"}`
      ]));         

    // New issue on the B&C Triage Board
    testCases.push(new TestCase(`${test_dir}/issue_created-bug_buttons_and_cards.json`,
      'created', 'JP', 'status',
      [
        `{"markdown":"JP Shipherd created a Jira Bug: **Test of notifier.  Please ignore **.\\n\\nThis is a test bug to see if jira notifier can update triage space with  new bugs.  \\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARK-174582"}`,
        `{"markdown":"JP Shipherd created a Jira Bug: **Test of notifier.  Please ignore **.\\n\\nThis is a test bug to see if jira notifier can update triage space with  new bugs.  \\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARK-174582"}`,
        `{"markdown":"JP Shipherd created a Jira Bug: **Test of notifier.  Please ignore **.\\n\\nThis is a test bug to see if jira notifier can update triage space with  new bugs.  \\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARK-174582"}`
      ]));         
      
  }
}

function initPostDeleteNotifyTestCases(testCases) {
  if (process.env.ENABLE_BOARD_TRANSITION_NOTIFICATIONS) {
    // One fewer bot is now looking at boards
    testCases.push(new TestCase(`${test_dir}/jira_issue_updated-transition_buttons_and_cards_bug_board-manual-edit.json`,
      'changed', 'Edel Joyce', 'status',
      [
        '', '', '', '', '', '',// nobody with a bot is assigned or mentioned in the description of this ticket
        `{"markdown":"Edel Joyce transitioned a(n) Epic from Definition to Delivery:\\n* [SPARK-150410](https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-150410): Adding Webex Community to help menu\\n   * Components: Client: Android, Client: Desktop (Windows and MacOS), Client: iOS, Client: Web\\n   * Team/PT: Webex Growth\\n\\nWhich matches the filter: [Filter for [Buttons and Cards] Bugs and feedback ](https://jira-eng-gpk2.cisco.com/jira/issues/?filter=29848)"}`,
        `{"markdown":"Edel Joyce transitioned a(n) Epic from Definition to Delivery:\\n* [SPARK-150410](https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-150410): Adding Webex Community to help menu\\n* Components: Client: Android, Client: Desktop (Windows and MacOS), Client: iOS, Client: Web\\n* Team/PT: Webex Growth\\n\\nWhich matches the filter: [JP Filter for Status Change Tests](https://jira-eng-gpk2.cisco.com/jira/issues/?filter=34567)"}`,
        `{"markdown":"Edel Joyce transitioned a(n) Epic from Definition to Delivery:\\n* [SPARK-150410](https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-150410): Adding Webex Community to help menu\\n* Components: Client: Android, Client: Desktop (Windows and MacOS), Client: iOS, Client: Web\\n* Team/PT: Webex Growth\\n\\nOn the board[[Buttons and Cards] Bugs and feedback ](https://jira-eng-gpk2.cisco.com/jira/secure/RapidBoard.jspa?rapidView=4263)"}`
      ]));         
    
    // Transition on JP Custom filter 34567
    testCases.push(new TestCase(`${test_dir}/issue_updated-action_status_change-type_feature_portfolio.json`,
      'changed', 'JP Shipherd', 'status',
      [
        '', // nobody with a bot is assigned or mentioned in the description of this ticket
        `{"markdown":"JP Shipherd transitioned a(n) Portfolio Feature from WORK STARTED to INTERNAL EARLY ACCESS:\\n* [SPARK-138557](https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-138557): Contact Center API\\n\\n* Team/PT: Developer Experience: API Innovations\\n\\nWhich matches the filter: [JP Filter for Status Change Tests](https://jira-eng-gpk2.cisco.com/jira/issues/?filter=34567)"}`
      ]));         
    
    // Transition on JP Custom filter 34567
    testCases.push(new TestCase(`${test_dir}/jira_issue_updated-action_resolved.json`,
      'changed', 'Prema Rao', 'status',
      [
        '', // nobody with a bot is assigned or mentioned in the description of this ticket
        `{"markdown":"Prema Rao transitioned a(n) Epic from Delivery to Done, Resolution:Resolved:\\n* [SPARK-137296](https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-137296): Traffic Shaping for Client Upgrade\\n* Components: Service: Client Upgrade\\n\\nWhich matches the filter: [JP Filter for Status Change Tests](https://jira-eng-gpk2.cisco.com/jira/issues/?filter=34567)"}`
      ]));         
  }    
  if (process.env.ENABLE_NEW_ISSUE_NOTIFICATIONS) {
    // New issue on the JSSDK Triage Board
    // testCases.push(new TestCase(`${test_dir}/issue_created-bug_jssdk.json`,
    //   'created', 'JP', 'status',
    //   [
    //     '', // nobody with a bot is assigned or mentioned in the description of this ticket
    //     `{"markdown":"Prema Rao transitioned a(n) Epic from Delivery to Done, Resolution:Resolved:\\n* [SPARK-137296](https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-137296): Traffic Shaping for Client Upgrade\\n* Components: Service: Client Upgrade\\n\\nWhich matches the filter: [JP Filter for Status Change Tests](https://jira-eng-gpk2.cisco.com/jira/issues/?filter=34567)"}`
    //   ]));         

    // New issue on the B&C Triage Board
    testCases.push(new TestCase(`${test_dir}/issue_created-bug_buttons_and_cards.json`,
      'created', 'JP', 'status',
      [
        `{"markdown":"JP Shipherd created a Jira Bug: **Test of notifier.  Please ignore **.\\n\\nThis is a test bug to see if jira notifier can update triage space with  new bugs.  \\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARK-174582"}`,
        `{"markdown":"JP Shipherd created a Jira Bug: **Test of notifier.  Please ignore **.\\n\\nThis is a test bug to see if jira notifier can update triage space with  new bugs.  \\n\\nhttps://jira-eng-gpk2.cisco.com/jira/browse/SPARK-174582"}`
      ]));         
      
  }
}

async function runInitTestCases(testCases, groupNotifier) {
  if (process.env.USE_PREVIOUSLY_DUMPED_BOARDS_CONFIG) {
    return loadPreviouslyDumpedBoardConfigs(testCases, groupNotifier);
  }

  return Promise.all(testCases.map(test => {
    return Promise.race([
      groupNotifier.boardTransitions.watchBoardForBot(test.bot, test.listIdOrUrl, test.listType),
      Promisedelay(promiseTimeout, {result: 'timeout', msg: `${test.description} timed out`})
    ])
      .then((boardInfo) => {
        if ('result' in boardInfo) {
          return processInitResolve(boardInfo, test, 'timeout');
        } else if (test.expectedPromise !== 'resolve') {
          return processInitResolve(boardInfo, test, 'fail');
        } else if (boardInfo.name !== test.expectedTitleOrError) {
          return processInitResolve(boardInfo, test, 'fail');
        } else {
          updateBotConfig(test.bot, boardInfo)
            .catch((e) => {
              console.error(`Problem storing the config for "${test.decription}: ${e.message}`);
            });
          return processInitResolve(boardInfo, test, 'pass');
        }
      })
      .catch((e) => {
        if (test.expectedPromise !== 'reject') {
          return processInitReject({msg: e.message}, test, 'fail');
        } else if (e.message != test.expectedTitleOrError) {
          return processInitReject({msg: e.message}, test, 'fail');
        } else {
          return processInitReject({msg: e.message}, test, 'pass');
        }
      });
  }))
    .then((results) => {
    // See if everything passed
      let failures = results.filter(r => r.testStatus != 'pass');
      if (failures.length) {
        console.log(failures);
        return Promise.reject(new Error(`Sorry, some init test(s) failed.`));
      }
      if (verbose) {
        console.log(results);
        console.log('All init tests passed!');
      }
      if (process.env.DUMP_INITIAL_BOARDS_CONFIG) {
        // Make a copy of any board notification configs that just got loaded
        let boardsInfo = JSON.parse(JSON.stringify(groupNotifier.boardTransitions.boardsInfo, null, 2));
        boardsInfo.forEach((board) => {
        // Strip the bot info in the dump
          let botsWithJustId = [];
          board.bots.forEach((bot) => botsWithJustId.push({id: bot.id}));
          board.bots = botsWithJustId;
        });

        try {
          fs.writeFileSync(process.env.DUMP_INITIAL_BOARDS_CONFIG, 
            JSON.stringify(boardsInfo, null, 2));
        } catch (e) {
          console.error(`Failed dumping initial config to path:${process.env.DUMP_INITIAL_BOARDS_CONFIG}.  Error: ${e.message}`);
        }
      }

      // All the init tests (if run) passed!
      return Promise.resolve();
    });
}



// Run the tests
async function runTests(testCases) {
  // Loop through the test cases to and send each one to the event processor
  let expectedCallbacks = 0;
  for (var i = 0, len = testCases.length; i < len; i++) {
    test = testCases[i];
    expectedCallbacks += test.numExpectedResults;
    var jiraEvent = JSON.parse(fs.readFileSync(test.file, "utf8"));
    jiraEventHandler.processJiraEvent(jiraEvent, framework, checkTestResult(framework, test, i + 1));
  }

  // Set a timer to determine when to check if we missed any of the expected callbacks
  let timerDuration = expectedCallbacks * 1000;  // Allow 1 seconds per callback (or use environment)
  if (process.env.TEST_TIMER_MULTIPLIER) {
    timerDuration = expectedCallbacks * parseInt(process.env.TEST_TIMER_MULTIPLIER);
  }
  myConsole.log(`Running ${testCases.length} tests expected to generate ${expectedCallbacks} responses.`);
  myConsole.log(`Set environment VERBOSE=true for more details.`);
  myConsole.log(`Will analyze results in ${timerDuration / 1000} seconds...`); 
  // TODO -- modify this so it doesn't return until the promise gets
  // resolved in the timeout handler
  return new Promise((r) => returnAfterTimeout(r, testCases, timerDuration));
}

// Report test results after our timer expires
function returnAfterTimeout(resolveMethod, testCases, timerDuration) {
  setTimeout(() => {
    let totalErrors = 0;
    let totalPassed = 0;
    for (var i = 0, len = testCases.length; i < len; i++) {
      test = testCases[i];
      totalErrors += test.numSeenErrors;
      totalPassed += test.numPassed;
      if ((test.result.length) && (test.result.length != test.numSeenErrors)) {
        for (result of test.result) {
          console.error(`Test ${i+1}: ${test.author} ${test.action} `+ 
            `${test.subject}, based on file: ${test.file}, never got expected result:`);
          console.error(result);
          totalErrors += 1;
        } 
      }
    }

    myConsole.log(`\nAll tests complete. ${totalPassed} tests passed.`);
    if (totalErrors) {
      console.error(`Number of errors seen: ${totalErrors}`);
    }
    resolveMethod();
  }, timerDuration);
};

// Jira event processor will call us back with the message that a bot sent
// Check to see if matches our expected result
function checkTestResult(framework, test, testNum) {
  return function jiraEventCallback(err, bot = null) {
    test.resultsSeen += 1;
    if (verbose) {
      myConsole.log(`Checking a result for test ${testNum}: ${test.author} ` +
        `${test.action} ${test.subject}, based on file: ${test.file}`);
    }

    if (err) {
      console.error('Test %d (Result %d of %d) Failed.', testNum, test.numExpectedResults);
      showExpected(`Got error in callback: ${err.message}`, test);
      return;
    }

    // Error if we got more results than expected.
    if (!test.result.length) {
      let seenResult = (bot) ? bot.jiraEventMessage : '';
      console.error(`Already got all ${test.numExpectedResults} expected results for test `
        `${testNum}. Extra result is: "${seenResult}"`);
      test.numSeenErrors++;
      return;
    }

    // No bot object means event processor found a user who could be notified
    // but they do not have not registered a space with the bot
    // (Configure users who have bots in init-test-cases.js in the TEST_CASE_DIR)
    if (!bot) {
      if (foundResult('', test)) {
        reportSuccess(test, 
          `Test ${testNum} (Result ${test.resultsSeen} of ${test.numExpectedResults}) Passed.  ` +
          'Got expected non-notification');
      } else {
        console.error('Test %d (Result %d of %d) Failed.', testNum, test.resultsSeen, test.numExpectedResults);
        showExpected('jiraEventHander did not find a bot for an intended recipent' +
          ', but our expected results do not include an empty response.', test);
      }
      return;
    }

    // Compare result that bot "sent" is in the list of expected results in the test case
    var resultFound = false;
    if (bot.jiraEventMessage) {
      resultFound = true;
      // Whitespace got me down, just removed it for this comparison
      if (foundResult(bot.jiraEventMessage, test)) {
        reportSuccess(test, 
          `Test ${testNum} (Result ${test.resultsSeen} of ${test.numExpectedResults}) Passed.  ` +
          'Got expected notification');
      } else {
        console.error('Test %d (Result %d of %d) Failed.', testNum, test.resultsSeen, test.numExpectedResults);
        showExpected(`Got\n${bot.jiraEventMessage}`, test);
      }
      bot.jiraEventMessage = '';
    }
    if (!resultFound) {
      if (!test.result) {
        reportSuccess(test, 
          `Test ${testNum} (Result ${test.resultsSeen} of ${test.numExpectedResults}) Passed.`);
      } else {
        console.error('Test %d (Result %d of %d) Failed.', testNum, test.resultsSeen, test.numExpectedResults);
        showExpected('Got no result', test);
      }
    }
  };
}


// Check the bot message against the set of valid results
// We need to look at all possible values because the order of 
// messages is not predictable since we are waiting on various
// jira API calls to give us info about mentioned or watching users
function foundResult(botMessage, test) {
  for (let i=0; i<test.result.length; i++) {
    // Strip whitespace to simply comparison
    if (botMessage.replace(/\s/g, '') === test.result[i].replace(/\s/g, '')) {
      // Remove this result from the set of expected result
      test.result.splice(i, 1);
      return true;
    }
  }
  return false;
}

// Function to display progress info
function reportSuccess(test, msg) {
  test.numPassed++;
  if (verbose) { 
    myConsole.log(msg); 
  }
}


// Function to display the expected results when a test fails
function showExpected(msg, test) {
  test.numSeenErrors += 1;
  console.error(`While processing test input: ${test.file}`);
  console.error(msg);
  if (test.result.length == 1) {
    console.error('Expected\n' + test.result[0]);
  } else {
    console.error('Expected one of:');
    for(let i=0; i<test.result.length; i++) {
      console.error(`${test.result[i]}`);
    }
  }
}

function Promisedelay(t, val) {
  return new Promise(resolve => {
    setTimeout(resolve.bind(null, val), t);
  });
};

// Load board Configs from previous run to speed up init
function loadPreviouslyDumpedBoardConfigs(testCases, groupNotifier) {
  let groupNotifierConfigs = require(process.env.USE_PREVIOUSLY_DUMPED_BOARDS_CONFIG);
  console.log(`Using preloaded boards config from ${process.env.USE_PREVIOUSLY_DUMPED_BOARDS_CONFIG}`);
  // Update each bot's config store for the transition notifications
  groupNotifierConfigs.forEach((board) => {
    let botIds = board.bots.map(bot => bot.id);
    let configBoard = JSON.parse(JSON.stringify(board));
    delete configBoard.stories;
    delete configBoard.bots;
    board.bots = [];
    botIds.forEach((id) => {
      let bot = _.find(framework.bots, bot => bot.id === id);
      // replace the bot from disk with our object that includes methods:
      board.bots.push(bot);
      updateBotConfig(bot, configBoard)
        .catch((e) => {
          console.error(`Failed updating bot's config during init from previous dump: ${e.message}`);
        });
    });
  });
  groupNotifier.boardTransitions.boardsInfo = groupNotifierConfigs;

  return Promise.resolve();
}


// Create the groupNotfier class which will create a boardNotifications object
function initGroupNotifier() {
  let groupNotifier = null;
  try {
    // Create the object for interacting with Jira
    var GroupNotifications = require('../group-notifier/group-notifications.js');
    groupNotifier = new GroupNotifications(jira, logger, frameworkConfig);
  } catch (err) {
    logger.error('Initialization Failure: ' + err.message);
    process.exit(-1);
  }
  return groupNotifier;
}

function processInitResolve(resObj, test, status) {
  resObj.testDescription = test.description;
  resObj.testStatus = status;
  resObj.expectedBoardTitle = test.expectedTitleOrError;
  return Promise.resolve(resObj);
}
function processInitReject(resObj, test, status) {
  resObj.testDescription = test.description;
  resObj.testStatus = status;
  resObj.expectedErrorMessage = test.expectedTitleOrError;
  return Promise.resolve(resObj);
}

function updateBotConfig(bot, board) {
  return bot.recall('groupSpaceConfig')
    .then((config) => {
      config.boards.push(board);
      return bot.store('groupSpaceConfig', config);
    });
}

// async function runTests(testCases, test_dir, jira, transitionConfig) {
//   // Wait for any test initialization to complete...
//   await initTests(testCases, test_dir, jira, transitionConfig);

//   // Loop through the test cases to and send each one to the event processor
//   let expectedCallbacks = 0;
//   for (var i = 0, len = testCases.length; i < len; i++) {
//     test = testCases[i];
//     expectedCallbacks += test.numExpectedResults;
//     var jiraEvent = JSON.parse(fs.readFileSync(test.file, "utf8"));
//     jiraEventHandler.processJiraEvent(jiraEvent, framework, checkTestResult(framework, test, i + 1));
//   }

//   // Set a timer to determine when to check if we missed any of the expected callbacks
//   let timerDuration = expectedCallbacks * 1000;  // Allow 1 seconds per callback (or use environment)
//   if (process.env.TEST_TIMER_MULTIPLIER) {
//     timerDuration = expectedCallbacks * parseInt(process.env.TEST_TIMER_MULTIPLIER);
//   }
//   console.log(`Running ${testCases.length} tests expected to generate ${expectedCallbacks} responses.`);
//   console.log(`Set environment VERBOSE=true for more details.`);
//   console.log(`Will analyze results in ${timerDuration / 1000} seconds...`); 
//   setTimeout(() => {
//     let totalErrors = 0;
//     let totalPassed = 0;
//     for (var i = 0, len = testCases.length; i < len; i++) {
//       test = testCases[i];
//       totalErrors += test.numSeenErrors;
//       totalPassed += test.numPassed;
//       if ((test.result.length) && (test.result.length != test.numSeenErrors)) {
//         for (result of test.result) {
//           console.log(`Test ${i+1}: ${test.author} ${test.action} `+ 
//             `${test.subject}, based on file: ${test.file}, never got expected result:`);
//           console.log(result);
//           totalErrors += 1;
//         } 
//       }
//     }

//     console.log(`\nAll tests complete. ${totalPassed} tests passed.`);
//     if (totalErrors) {
//       console.error(`Number of errors seen: ${totalErrors}`);
//     }
//     process.exit();
//   }, timerDuration);
// }



// Jira event processor will call us back with the message that a bot sent
// Check to see if matches our expected result
function checkTestResult(framework, test, testNum) {
  return function jiraEventCallback(err, bot = null) {
    test.resultsSeen += 1;
    if (verbose) {
      console.log(`Checking a result for test ${testNum}: ${test.author} ` +
        `${test.action} ${test.subject}, based on file: ${test.file}`);
    }

    if (err) {
      console.error('Test %d (Result %d of %d) Failed.', testNum, test.numExpectedResults);
      showExpected(`Got error in callback: ${err.message}`, test);
      return;
    }

    // Error if we got more results than expected.
    if (!test.result.length) {
      let seenResult = (bot) ? bot.jiraEventMessage : '';
      if ((!bot) && (!seenResult)) {
        if (verbose) {
          console.error(`Already got all ${test.numExpectedResults} expected results for test ` +
          `${testNum}, but saw an empty response. This can happen when new watchers were added ` +
          `the issue since the test was originally created.  Ignoring.`);
        }
      } else {
        console.error(`Already got all ${test.numExpectedResults} expected results for test ` +
          `${testNum}. Extra result is: "${seenResult}"`);
        test.numSeenErrors++;
      }
      return;
    }

    // No bot object means event processor found a user who could be notified
    // but they do not have not registered a space with the bot
    // (Configure users who have bots in init-test-cases.js in the TEST_CASE_DIR)
    if (!bot) {
      if (foundResult('', test)) {
        reportSuccess(test, 
          `Test ${testNum} (Result ${test.resultsSeen} of ${test.numExpectedResults}) Passed.  ` +
          'Got expected non-notification');
      } else {
        console.error('Test %d (Result %d of %d) Failed.', testNum, test.resultsSeen, test.numExpectedResults);
        showExpected('jiraEventHander did not find a bot for an intended recipent' +
          ', but our expected results do not include an empty response.', test);
      }
      return;
    }

    // Compare result that bot "sent" is in the list of expected results in the test case
    var resultFound = false;
    if (bot.jiraEventMessage) {
      resultFound = true;
      // Whitespace got me down, just removed it for this comparison
      if (foundResult(bot.jiraEventMessage, test)) {
        reportSuccess(test, 
          `Test ${testNum} (Result ${test.resultsSeen} of ${test.numExpectedResults}) Passed.  ` +
          'Got expected notification');
      } else {
        console.error('Test %d (Result %d of %d) Failed.', testNum, test.resultsSeen, test.numExpectedResults);
        showExpected(`Got\n${bot.jiraEventMessage}`, test);
      }
      bot.jiraEventMessage = '';
    }
    if (!resultFound) {
      if (!test.result) {
        reportSuccess(test, 
          `Test ${testNum} (Result ${test.resultsSeen} of ${test.numExpectedResults}) Passed.`);
      } else {
        console.error('Test %d (Result %d of %d) Failed.', testNum, test.resultsSeen, test.numExpectedResults);
        showExpected('Got no result', test);
      }
    }
  };
}


// Check the bot message against the set of valid results
// We need to look at all possible values because the order of 
// messages is not predictable since we are waiting on various
// jira API calls to give us info about mentioned or watching users
function foundResult(botMessage, test) {
  for (let i=0; i<test.result.length; i++) {
    // Strip whitespace to simply comparison
    if (botMessage.replace(/\s/g, '') === test.result[i].replace(/\s/g, '')) {
      // Remove this result from the set of expected result
      test.result.splice(i, 1);
      return true;
    }
  }
  return false;
}

// Function to display progress info
function reportSuccess(test, msg) {
  test.numPassed++;
  if (verbose) { 
    console.log(msg); 
  }
}


// Function to display the expected results when a test fails
function showExpected(msg, test) {
  test.numSeenErrors += 1;
  console.error(`While processing test input: ${test.file}`);
  console.error(msg);
  if (test.result.length == 1) {
    console.error('Expected\n' + test.result[0]);
  } else {
    console.error('Expected one of:');
    for(let i=0; i<test.result.length; i++) {
      console.error(`${test.result[i]}`);
    }
  }
}

