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
// Turn on Group Notifications in general
process.env.ENABLE_GROUP_NOTIFICATION = true;
// Turn on Board Transition Notifications
process.env.ENABLE_GROUP_TRANSITIONS_NOTIFICATIONS = true;
// Pass minimal security check when giving out jira info in group spaces
let frameworkConfig = {
  restrictedToEmailDomains: 'This must be set or the group notfications will fail'
};


// Create the groupNotfier class which will create a boardNotifications object
let groupNotifier = initGroupNotifier();

// JiraEventHandler processes all events, for 1-1 and group spaces
const JiraEventHandler = require("../jira-event.js");
// Is this needed?
// const {group} = require('console');
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
}

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
    return when.reject(new Error('Invalid function arguments'));
  }
};


// For test cases just treat replies as a regular message from the
Bot.prototype.reply = function (parentId, msg) {
  this.say(msg);
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

// Build the list of init test objects.
function InitTestCse(description, bot, boardId, expectedPromise, expectedTitleOrError) {
  this.description = description;
  this.bot = bot;
  this.boardId = boardId;
  this.expectedPromise = expectedPromise;
  this.expectedTitleOrError = expectedTitleOrError;
}
var initTestCases =[];
initTestCases.push(new InitTestCse('bot1 adds boardId 4263', bot1, '4263', 'resolve', '[Buttons and Cards] Bugs and feedback '));
initTestCases.push(new InitTestCse('bot2 adds boardId 4263 by web url', bot2, 'https://jira-eng-gpk2.cisco.com/jira/secure/RapidBoard.jspa?rapidView=4263', 'resolve', '[Buttons and Cards] Bugs and feedback '));
initTestCases.push(new InitTestCse('bot2 adds boardId 2885', bot2, '2885', 'resolve', 'Webex SMB Transition Review'));
initTestCases.push(new InitTestCse('bot3 adds boardId 4289', bot3, '4289', 'resolve', '(AX) App Experience, Shared and Foundation'));
initTestCases.push(new InitTestCse('bot3 adds boardId 428999', bot1, '428999', 'reject', 'Could not find a board matching 428999'));
initTestCases.push(new InitTestCse('bot3 adds board via bad jira url', bot1, 'https://jira-foo.foobar.com/jira/secure/RapidBoard.jspa?rapidView=4263', 'reject', 'Could not find a board matching https://jira-foo.foobar.com/jira/secure/RapidBoard.jspa?rapidView=4263'));
initTestCases.push(new InitTestCse('bot3 adds board via bad board url', bot1, 'https://jira-eng-gpk2.cisco.com/jira/secure/SlowBoard.jspa?rapidView=4263', 'reject', 'Could not find a board matching https://jira-eng-gpk2.cisco.com/jira/secure/SlowBoard.jspa?rapidView=4263'));
initTestCases.push(new InitTestCse('bot3 adds board via bad board id query param', bot1, 'https://jira-eng-gpk2.cisco.com/jira/secure/RapidBoard.jspa?rapidView=NameInsteadOfNumber', 'reject', 'Could not find a board matching https://jira-eng-gpk2.cisco.com/jira/secure/RapidBoard.jspa?rapidView=NameInsteadOfNumber'));

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
    console.log('Ready to start notifying!');
    // TODO add another environment variable to optionally dump the config to a file
    // console.log(JSON.stringify(groupNotifier.boardTransitions.boardsInfo, null, 2));
    //console.log(notifyTestCases[0]);
    // var jiraEvent = JSON.parse(fs.readFileSync(notifyTestCases[0].file, "utf8"));
    // jiraEventHandler.processJiraEvent(jiraEvent, framework, checkTestResult(framework, notifyTestCases[0], 0 + 1));

    // Try sending our single test case through the test case runner
    // In the other test framework tests are initialized inside here
    // For now we have pre-initialized the notifyTestCases array with a single test case
    runTests(notifyTestCases, test_dir, jira, groupNotifier);
  })
  .catch(e => {
    console.log(`runInitTestCases failed: ${e.message}`);
    process.exit(-1);
  });

function initNotifyTestCases(testCases) {
  testCases.push(new TestCase(`${test_dir}/jira_issue_updated-transition_buttons_and_cards_bug_board-manual-edit.json`,
    'changed', 'Edel Joyce', 'status',
    [
      '', // nobody with a bot is assigned or mentioned in the description of this ticket
      `{"markdown":"Edel Joyce transitioned a(n) Epic from Definition to Delivery:\\n* [SPARK-150410](https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-150410): Adding Webex Community to help menu\\n* Components: Client: Android, Client: Desktop (Windows and MacOS), Client: iOS, Client: Web\\n* Team/PT: Webex Growth\\n\\nOn the board: [Buttons and Cards] Bugs and feedback "}`,
      `{"markdown":"Edel Joyce transitioned a(n) Epic from Definition to Delivery:\\n* [SPARK-150410](https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-150410): Adding Webex Community to help menu\\n* Components: Client: Android, Client: Desktop (Windows and MacOS), Client: iOS, Client: Web\\n* Team/PT: Webex Growth\\n\\nOn the board: [Buttons and Cards] Bugs and feedback "}`
    ]));         
    
}


async function runInitTestCases(testCases, groupNotifier) {
  if (process.env.USE_PREVIOUSLY_DUMPED_BOARDS_CONFIG) {
    groupNotifier.boardTransitions.boardsInfo = require(process.env.USE_PREVIOUSLY_DUMPED_BOARDS_CONFIG);
    console.log(`Using preloaded boards config from ${process.env.USE_PREVIOUSLY_DUMPED_BOARDS_CONFIG}`);
    // replace the bot objects read from the file with the real bots we just created
    groupNotifier.boardTransitions.boardsInfo.forEach(board => {
      let botIds = board.bots.map(bot => bot.id);
      board.bots = [];
      botIds.forEach(id => {
        let bot = _.find(framework.bots, bot => bot.id === id);
        board.bots.push(bot);
      });
    });
    return Promise.resolve();

  }
  return Promise.all(testCases.map(test => {
    let result;
    return Promise.race([
      groupNotifier.boardTransitions.watchBoardForBot(test.bot, test.boardId),
      Promisedelay(promiseTimeout, {result: 'timeout', msg: `${test.description} timed out`})
    ])
      .then((boardInfo) => {
        if ('result' in boardInfo) {
          result = processInitResolve(boardInfo, test, 'timeout');
        } else if (test.expectedPromise !== 'resolve') {
          result = processInitResolve(boardInfo, test, 'fail');
        } else if (boardInfo.name !== test.expectedTitleOrError) {
          result = processInitResolve(boardInfo, test, 'fail');
        } else {
          result = processInitResolve(boardInfo, test, 'pass');
        }
        return Promise.resolve(result);
      })
      .catch((e) => {
        if (test.expectedPromise !== 'reject') {
          result = processInitReject({msg: e.message}, test, 'fail');
        } else if (e.message != test.expectedTitleOrError) {
          result = processInitReject({msg: e.message}, test, 'fail');
        } else {
          result = processInitReject({msg: e.message}, test, 'pass');
        }
        return Promise.resolve(result);
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
        // Make a copy of what just got loaded
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



// Create the groupNotfier class which will create a boardNotifications object
function initGroupNotifier() {
  let groupNotifier = null;
  if (process.env.ENABLE_GROUP_NOTIFICATIONS) {
    try {
      // Create the object for interacting with Jira
      var GroupNotifications = require('../group-notifier/group-notifications.js');
      groupNotifier = new GroupNotifications(jira, logger, frameworkConfig);
    } catch (err) {
      logger.error('Initialization Failure: ' + err.message);
      process.exit(-1);
    }
  }
  return groupNotifier;
}




// Run the tests
// runTests(testCases, test_dir, jiraConnector, transitionConfig);

async function runTests(testCases, test_dir, jira, transitionConfig) {
  // Wait for any test initialization to complete...
  // TODO Add this.  Right now I am pre-initializing a single test case
  //await initTests(testCases, test_dir, jira, transitionConfig);

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
  setTimeout(() => {
    let totalErrors = 0;
    let totalPassed = 0;
    for (var i = 0, len = testCases.length; i < len; i++) {
      test = testCases[i];
      totalErrors += test.numSeenErrors;
      totalPassed += test.numPassed;
      if ((test.result.length) && (test.result.length != test.numSeenErrors)) {
        for (result of test.result) {
          myConsole.log(`Test ${i+1}: ${test.author} ${test.action} `+ 
            `${test.subject}, based on file: ${test.file}, never got expected result:`);
          myConsole.log(result);
          totalErrors += 1;
        } 
      }
    }

    myConsole.log(`\nAll tests complete. ${totalPassed} tests passed.`);
    if (totalErrors) {
      console.error(`Number of errors seen: ${totalErrors}`);
    }
    process.exit();
  }, timerDuration);
}



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

function processInitResolve(resObj, test, status) {
  resObj.testDescription = test.description;
  resObj.testStatus = status;
  resObj.expectedBoardTitle = test.expectedTitleOrError;
  return resObj;
}
function processInitReject(resObj, test, status) {
  resObj.testDescription = test.description;
  resObj.testStatus = status;
  resObj.expectedErrorMessage = test.expectedTitleOrError;
  return resObj;
}

// Run the tests
//runTests(testCases, test_dir, jira, transitionConfig);

async function initTests(testCases, test_dir, jiraC, transitionConfig) {
  // If configured to use TR Boards as filters, load in the initial cache of issues
  if (process.env.JIRA_TRANSITION_BOARDS) {
    try { 
      console.info('Found Transition Boards to filter on, will try to read all their issues..');
      await jira.initTRBoardCache();
    } catch (e) {
      console.error('initTRBoardCache failed to lookup all issues on TR boards.  Check configuration. ' +
        'TR Notifications will be sent without this filter');
      process.exit();
    }
  }
  testCases.initTestCases(testCases, test_dir, jira.getJiraUrl(), transitionConfig);
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


function exitWithTransitionConfigError() {
  console.error(`To configure the bot to notify for jira transitions ALL of the environment variables must be set:\n` +
  `  - TRANSITION_PROJECTS: - list of jira projects to notify for\n`+
  `  - TRANSITION_STATUS_TYPES: - list of jira status values to notify for\n`+
  `  - TRANSITION_ISSUE_TYPES: - list of jira issue types to notify for\n\n`+
  ` All values should be comma separated lists with no spaces.  Capitalization must match the jira configuration.`);
  process.exit(0);
}
