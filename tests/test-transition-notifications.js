// test-transition-notifications.js
//
// Run some prepared jira event through the handler to ensure
// that we get our expected results
/*jshint esversion: 6 */  // Help out our linter

// See readme to determine how to configure test via environment
require('dotenv').config();
fs = require('fs');
path = require('path');
var _ = require('lodash');


// SET LOG_LEVEL to enable/quiet underlying app logging
var logger = require('../logger');

// Ensure that the directory where the canned Jira Events are exists
let test_dir;
try {
  test_dir = path.resolve(process.env.TEST_CASE_DIR);
} catch {
  console.error(`Unable to resolve TEST_CASE_DIR: ${process.env.TEST_CASE_DIR}`);
  process.exit();
}

// Initialize the "framework" that is passed to the notification handler
let Framework = require('./test-framework');
// Pass minimal security check when giving out jira info in group spaces
let frameworkConfig = {
  restrictedToEmailDomains: 'This must be set or the group notfications will fail'
};
let framework = new Framework(frameworkConfig);

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

// Read in the configuration for our tests
let conf = require(`./transition-test-config`);

// Create some bots for our tests
let Bot = require('./test-bot');
if (conf?.testConfig?.botsToTest?.length) {
  conf.testConfig.botsToTest.forEach((test) => {
    framework.bots.push(new Bot(test, verbose));
  });  
} else {
  console.error('At least one botToTest must be specified in transition-test-config');
  process.exit();
}

// Define the class used for our initial load board config tests
function InitTestCase(description, bot, listIdOrUrl, listType, expectedPromise, expectedTitleOrError) {
  this.description = description;
  this.bot = bot;
  this.listIdOrUrl = listIdOrUrl;
  this.listType = listType;
  this.expectedPromise = expectedPromise;
  this.expectedTitleOrError = expectedTitleOrError;
}

// Configure the "initiatialization test cases" which will emulate
// users interacting with the bot and asking it to watch filters in
// one of our test spaces
var initTestCases;
if (conf?.testConfig?.addBoardsToSpacesTests?.length) {
  initTestCases = readInitCasesFromConfig(conf.testConfig.addBoardsToSpacesTests);
} else {
  console.error('At least one addBoardsToSpacesTests must be specified in transition-test-config');
  process.exit();
}

// Define the object we use to run our jira event test cases
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

// Configure the "notification test cases" which will emulate
// jira-events occuring which may trigger notifications in one of
// our "Webex spaces" that are configured to watch boards with it
var notifyTestCases;
if (conf?.testConfig?.firstPassTestCases?.length) {
  notifyTestCases = readNotifyTestCasesFromConfig(conf.testConfig.firstPassTestCases);
} else {
  console.error('At least one firstPassTestCases must be specified in transition-test-config');
  process.exit();
}

// Run the tests!
// First the init cases validate that the "test bots" properly
// handle the button presses to add boards to watch
runInitTestCases(initTestCases, groupNotifier)
  .then(() => {
    // The init tests passed!
    // If configured force a re-read of the cache to validate that works
    if (process.env.TEST_CACHE_UPDATE_LOGIC) {
      return groupNotifier.boardTransitions.updateStoriesForBoards(
        groupNotifier.boardTransitions.boardsInfo
      );
    } else {
      return Promise.resolve();
    }
  })
  .then(() => {
    // Run the first pass of tests to check if the defined jira events
    // generate the expected notifications
    console.log('Ready to start notifying!');
    return runTests(notifyTestCases, test_dir, jira, groupNotifier);
  })
  .then(() => {
    // If configured, emulate button presses to delete some of the boards
    // from some of the bots
    let deleteBoardButtonPressTriggers = deleteBoardButtonPresses(conf);
    if (deleteBoardButtonPressTriggers.length) {
      let actionPromises = [];
      deleteBoardButtonPressTriggers.forEach((buttonPress) => {
        console.log(`Removing watched boards from test bots: ${buttonPress.bot.room.title}.`);
        actionPromises.push(groupNotifier.processAttachmentAction(buttonPress.bot, buttonPress.trigger));
      });
      return Promise.all(actionPromises);
    } else {
      console.log(`No delete board button presses configured.   Tests complete`);
      process.exit();
    }
  })
  .then(() => {
    // Read in the second pass of test cases.  These are usually
    // the same events as the first pass, but with fewer expected notifications
    if (conf?.testConfig?.secondPassTestCases?.length) {
      notifyTestCases = readNotifyTestCasesFromConfig(conf.testConfig.secondPassTestCases);
      console.log('Running notification tests again.');
      return runTests(notifyTestCases, test_dir, jira, groupNotifier); 
    } else {
      console.error('No secondPassTestCases configured. Tests complete');
      process.exit();
    }
  })
  // TODO add another option rerun of the tests after the cache has been updated.
  .catch(e => {
    console.log(`runInitTestCases failed: ${e.message}`);
    process.exit(-1);
  });

// If we didn't hit our catch block all tests passed

/**
 * Helper functions to read in test configurations and 
 * configure the groupNotifier object
 * 
 */
 
function readInitCasesFromConfig(addBoardsTestCases) {
  let initTestCases = [];
  addBoardsTestCases.forEach((test) => {
    if (((test.testType === 'transitionTest') && 
      (!process.env.SKIP_BOARD_TRANSITION_NOTIFICATIONS)) ||
      ((test.testType === 'newIssueTest') &&
      (!process.env.SKIP_NEW_ISSUE_NOTIFICATIONS)))
    {
      initTestCases.push(new InitTestCase(
        test.testName, 
        framework.bots[test.botIndex], 
        test.boardOrFilterId, test.boardType,
        test.expectedResult, 
        test.expectedMessage));
    }
  }); 
  return initTestCases;
}

function readNotifyTestCasesFromConfig(testCasesConfig) {
  let testCases = [];
  testCasesConfig.forEach((test) => {
    if (((test.testType === 'transitionTest') && 
      (!process.env.SKIP_BOARD_TRANSITION_NOTIFICATIONS)) ||
      ((test.testType === 'newIssueTest') &&
      (!process.env.SKIP_NEW_ISSUE_NOTIFICATIONS)))
    {
      testCases.push(new TestCase(
        `${test_dir}/${test.eventData}`,
        test.userAction, test.user, test.userTarget,
        test.expectedNotifications)); 
    }
  });
  return testCases;
}

function initGroupNotifier() {
  // Create the groupNotfier class which will create a boardNotifications object
  let groupNotifier = null;
  try {
    // Create the object for interacting with Jira
    var GroupNotifications = require('../group-notifier/group-notifications.js');
    groupNotifier = new GroupNotifications(jira, logger, framework.config);
  } catch (err) {
    logger.error('Initialization Failure: ' + err.message);
    process.exit(-1);
  }
  return groupNotifier;
}

  
/**
 * Functions to run the Add/Delete Board Test cases
 * 
 */
async function runInitTestCases(testCases, groupNotifier) {
  if (process.env.USE_PREVIOUSLY_DUMPED_BOARDS_CONFIG) {
    return loadPreviouslyDumpedBoardConfigs(groupNotifier);
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

function loadPreviouslyDumpedBoardConfigs(groupNotifier) {
  // Load board Configs from previous run to speed up init
  let groupNotifierConfigs = require(`${path.resolve(process.env.USE_PREVIOUSLY_DUMPED_BOARDS_CONFIG)}`);
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

function deleteBoardButtonPresses(conf) {
  buttonPresses = [];
  if (conf?.testConfig?.boardDeleteTests?.length) {
    conf.testConfig.boardDeleteTests.forEach((test) => {
      buttonPresses.push({
        bot: framework.bots[test.botIndex],
        trigger: {
          attachmentAction: {
            messageId: framework.bots[test.botIndex].getFakeCardId(),
            inputs: {
              requestedTask: "updateBoardConfig",
              boardsToDelete: test.boardsToDelete
            }
          }      
        }
      })
    });
  }
  return buttonPresses;
};

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

/**
 * Functions to send in the canned jira events and
 * process the results
 * 
 */
async function runTests(testCases) {
  // Loop through the test cases to and send each one to the event processor
  let expectedCallbacks = 0;
  for (var i = 0, len = testCases.length; i < len; i++) {
    test = testCases[i];
    expectedCallbacks += test.numExpectedResults;
    var jiraEvent = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), test.file), "utf8"));
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

