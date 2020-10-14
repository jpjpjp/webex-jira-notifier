// board-transition.js
/*jshint esversion: 6 */  // Help out our linter
var when = require('when');
var _ = require('lodash');

/**
 * An optional module for the jira notifier bot.
 * When enabled it can track activity on "jira boards"
 * A board can be a board as seen under the "Boards" menu
 * or it can simply be the list of issues associated with
 * a filter that drives any other type of board,
 * such as a Dashboard, Portfolio Plan, etc
 * 
 * This is one of the types of notifications supported in 
 * group spaces.
 *
 * If a new issue is created that will show up on a board/filter
 * a notification is sent.  Although we allow users to specify
 * boards or filters we use the term "board" generically in this module
 * to refer to a list of stories being watched.
 *
 * If an issue is updated, this module can check to 
 * see if the update contitutes a "transition" (status change)
 * and if the issue is on a watched list/board it can notify 
 * the group space that requested updates on the board
 * 
 * Future versions of this might support updates for things other
 * than new issue creation or status changes, or provide more 
 * extensibility on how users configure it.
 *
 * @module BoardTransitions
 */
class BoardTransitions {
  /**
   * BoardTransition constructor
   * 
   * @param {object} jiraConnector -- an instantiated jiraConnector object
   * @param {object} groupStatus -- object for posting cards about config status
   * @param {object} logger - instance to a logging object
   * @param {integer} cacheDuration -- optional time to refresh board lookup
   */
  constructor(jiraConnector, groupStatus, logger, cacheDuration=null) {
    // Authenticated Object to call jira APIs
    this.jira = jiraConnector;
    this.groupStatus = groupStatus;
    this.logger = logger;

    // Check if our bot was configured with a Transition Board Cache Duration
    this.boardCacheDuration = (cacheDuration) ? cacheDuration : 6 * 60 * 60 * 1000;  // six hours

    // Lists that help us keep track of the boards we are watching
    this.boardIdObjs = [];
    this.boardsInfo = [];
    this.pendingBotAdds = [];

    // RegExps used to identify some common issues with the way
    // users ask for boards and filters
    this.quickFilterRegexp = new RegExp(/^.*\&quickFilter=\d+$/);

  }

  /** 
   * Register a bot/board combination to keep track of
   * 
   * If the board has already been looked up and is in cache, 
   * the bot is added to the list of spaces that need to be notified
   * 
   * @function watchBoardForBot
   * @param {object} bot - bot object for space requesting board notifications
   * @param {string} boardIdString - id of or web url to the list the bot wants to watch
   * @param {string} boardIdType - optional, type of list (ie: board, filter)
   * @returns {Promise.<Object>} - a public list object with id, type, name, and num of stories
   */
  watchBoardForBot(bot, boardIdString, boardIdType = null) {
    return this.jira.getBoardOrFilterObjFromIdOrUrl(boardIdString, boardIdType)
    .then((boardIdObj) => {
      // TODO -- could this logic be simplified?  Right now we wait until the 
      // complete list of stories associated with a list is avaialble before
      // adding it to our list of boards to watch.   Perhaps we can add the list info
      // to our watch list even before the cache is fully populated and just update
      // the cache when it is available?
      this.logger.info(`Space "${bot.room.title}" asked to watch a ${boardIdObj.type}, ID:${boardIdObj.id}`);
      let boardId = boardIdObj.id;
      let boardType = boardIdObj.type;

      if (-1 != this.boardIdObjs.findIndex(idObj =>
        ((idObj.id == boardId) && (idObj.type == boardType)))) {
        // This board has already been requested.  Is it cached?
        let board = _.find(this.boardsInfo, board => 
          ((board.id === boardId) && (board.type === boardType))); 
        if (board) {
          this.logger.info(`${boardType} ${boardId}:"${board.name}" already in cache.  Adding this bot to the list of followers.`);
          this.addBotToBoardInfo(bot, board);
          return new Promise((res, rej) => 
            returnWhenNotPending(res, rej, this.pendingBotAdds,boardIdObj, bot, 10, this));
        } else {
          // board requested but not cached yet, add this bot to the 
          // list of bots to be added to cached info when ready
          this.logger.info(`This ${boardType} has been requestd but is not yet in cache.  Will add this bot when cache is ready.`);
          this.pendingBotAdds.push({boardIdObj, bot});
          // return when the bot has been added to the boardsId list
          return new Promise((res, rej) => 
            returnWhenNotPending(res, rej, this.pendingBotAdds,boardIdObj, bot, 10, this));
        }
      } else {
        this.logger.info(`This is a new ${boardType}.  Will validate it and add stories to cache.`);
        this.boardIdObjs.push(boardIdObj);
        this.pendingBotAdds.push({boardIdObj, bot});
        return this.jira.lookupListByIdAndType(boardId, boardType).catch((e) => {
            e.boardProblemType = 'boardLookup';
            e.message = `Unable to find ${boardType} ${boardId}\n` +
              `Make sure to specify the correct board/filter type and ensure permissions allow view access to all jira users.`;
            return when.reject(e);
          })
        .then((board) => {
          return this.jira.lookupAndStoreListIssues(board).catch((e) => {
            e.boardProblemType = 'storiesLookup';
            e.message = `Unable to see issues associated with ${boardType} ${boardId}\n` +
              `Post a message in the [Ask JiraNotification Bot space](https://eurl.io/#Hy4f7zOjG) `+
              `to get info about the accounts your Jira administrator will need to provide view access to.`;
            return when.reject(e);
          })
        })
        .then((board) => {
          this.logger.info(`${boardId} is a valid ${boardType}: "${board.name}" Added ${board.stories.length} stories to cache.`);
          this.addBotToBoardInfo(bot, board);
          this.addBoardToWatchedSet(board);
          this.updateBoardInfoWithPendingBots();
          return  new Promise((res, rej) => 
            returnWhenNotPending(res, rej, this.pendingBotAdds,boardIdObj, bot, 10, this));
        })
        .catch(e => {
          // Cleanup any pending board/bot pairs waiting for this failed lookup
          this.logger.info(`watchBoardForBot: Failed getting info for ${boardType}:${boardId}, requested in space "${bot.room.title}": ${e.message}`);
          this.pendingBotAdds = _.reject(this.pendingBotAdds, b => 
            ((b.boardIdObj.id ===boardIdObj.id) && (b.boardIdObj.type === boardIdObj.type) &&
              (b.bot.id === bot.id)));
          this.boardIdObjs = this.boardIdObjs.filter(idObj => 
            (!((idObj.id == boardId) && (idObj.type == boardType)))); 
          return when.reject(e);
        });
      }
    })
    .catch((e) => {
      if (e.boardProblemType) {
        // Board info appeared valid, could be a permissions issue
        // Pass through an error object with details that bot can send user
        return when.reject(e);
      }
      let type = (boardIdType) ? boardIdType : 'board or filter';
      let msg = `Could not find a ${type} matching ${boardIdString}`;
      if (this.quickFilterRegexp.test(boardIdString)) {
        msg = `Jira APIs do no provide access to quickFilter info.  To monitor ` +
          'changes on a board with quick filters, create a filter that combines ' +
          'the board filter and the quick fileters you are interested in, and ' +
          'then ask me to watch that filter.';
      }
      this.logger.info(`BoardTransition:watchBoardForBot: ${msg}. ` +
        `Requested by bot from spaceID:${bot.room.id}\nError:${e.message}`);
      return when.reject(new Error(`${msg}`));
    });

  }

  /** 
   * Check pendingBot queue to see if any new boards are now in the cache
   * 
   * @function updateBoardInfoWithPendingBots
   */
  updateBoardInfoWithPendingBots() {
    this.logger.debug(`Checking ${this.pendingBotAdds.length} pending bot/board requests against ${this.boardsInfo.length} cached boards`);
    for(let i = this.pendingBotAdds.length -1; i >= 0 ; i--) {
      let botBoardInfo = this.pendingBotAdds[i];
      let pendingId = botBoardInfo.boardIdObj.id;
      let pendingType = botBoardInfo.boardIdObj.type;
      let waitingBot = botBoardInfo.bot;
      let board = _.find(this.boardsInfo, board => 
        ((board.id === pendingId) && (board.type === pendingType))); 
      if (board) {
        this.logger.info(`${pendingType}:${pendingId} now in cache.  Bot for ${waitingBot.room.title} will now notify for its transitions`);
        this.addBotToBoardInfo(waitingBot, board);
        this.pendingBotAdds.splice(i, 1);
      }
    }
    this.logger.debug(`After update ${this.pendingBotAdds.length} bots are still waiting for their board to cache`);
  }

  /** 
   * Return the public info about board that a bot might need
   * 
   * @function getPublicBoardInfo
   * @param {string} boardIdObj - board id/type bot wants to watch
   */
  getPublicBoardInfo(boardIdObj) {
    let board = _.find(this.boardsInfo, board => 
      ((board.id === boardIdObj.id) && (board.type === boardIdObj.type)))
    if (board) {
      return {id: board.id, type: boardIdObj.type, name: board.name, viewUrl: board.viewUrl, numStories: board.stories.length};
    } else {
      this.logger.warn(`getPublicBoardInfo failed to find ${boardIdObj.type} with id ${boardIdObj.id}.  Returning empty object`)
      return {id: boardIdObj.Id, type: boardIdObj.type, name: "Not Found", numStories: 0};
    }
  } 

  /**
   * Evaluate and potentially notify group spaces about 
   * transitions occuring on watched boards
   * 
   * @param {object} msgElement - the data needed to create a notification for this jira event
   * @param {function} createNewIssueMsgFn -- function to create a new issue notification message
   * @param {function} sendMessageFn - the group notifier objects function to send notifications
   * @param {function} cb - the (optional) callback function used by the test framework
   */
  evaluateForTransitionNotification(msgElements, createNewIssueMsgFn, sendMessageFn, cb) {
    try {
      // No point evaluating if no one is listening...
      if (!this?.boardsInfo?.length) { 
        return;
      }  

      // Is this issue event a New Issue Notification candidate?
      if (msgElements.jiraEvent.webhookEvent === 'jira:issue_created') {
        return this.processNewIssueNotifications(msgElements, 
          createNewIssueMsgFn, sendMessageFn, cb);
      }
      
      // Is this issue event a TR Notification candidate
      if ((msgElements.jiraEvent.webhookEvent !== 'jira:issue_updated') ||
      (msgElements.action !== 'status') || (typeof msgElements.jiraEvent.issue.fields !== 'object')) {
        return;
      }

      // This is a candidate. Is it on any of the boards we are watching?
      if (this.boardsInfo.length) {
        let boards = this.issueOnWatchedBoard(msgElements.issueKey);
        if (boards.length) {
          this.notifyTransitionSpaces(msgElements, boards, sendMessageFn, cb);
        }
      } 
      
    } catch(e) {
      return Promise.reject(new Error(
        `evaluateForTransitionNotification() caught exception: ${e.message}`
      ));
    }
  }

  /**
   * Check new issues against watched boards, updating story caches as needed
   * 
   * @param {object} msgElement - the data needed to create a notification for this jira event
   * @param {function} createMessageFn -- function to create a jira event notification message
   * @param {function} sendMessagFn -- the groupNotifier objects method to post about events
   * @param {function} cb - the (optional) callback function used by the test framework
   */
  processNewIssueNotifications(msgElements, createMessageFn, sendMessageFn, cb) {
    try {
      // We have a new issue, lets see if any spaces want to be notified about it
      this.logger.debug(`boardNotifications.processNewIssueNotifications: Got an issue created ` +
        `event for ${msgElements.issueKey}.  Checking if it matches any watched filters...`);
      let msg = '';
  
      this.boardsInfo.forEach(board => {
        // Add this issues key to the JQL Query
        let jqlUrl = this.updateJQLForThisIssue(board.searchUrl, msgElements.issueKey);
        return this.jira.getStoriesFromUrl(jqlUrl)
        .then((stories) => {
          if (stories.length > 1) {
            this.logger.error(`boardNotifications.processNewIssueNotifications: Filter: ${jqlUrl} lookup ` +
            `returned ${stories.length} stories.  Expected or 1.  Ignoring`);
          }
          if (stories.length === 1) {
            if (stories[0].key != msgElements.issueKey) {
              this.logger.error(`boardNotifications.processNewIssueNotifications: Filter: ${jqlUrl} lookup ` +
              `returned ${stories[0].key}.  Expected ${msgElements.key}.  Ignoring`);
            } else {
              // update the story cache for this board
              board.stories.push(msgElements.issueKey);

              // Notify spaces watching this board
              if (!msg) {
                msg = createMessageFn(msgElements, null/* bot.isDirectTo */, this.jira)
              }
              this.notifyAllBotsWatchingBoard(board, msgElements, msg, sendMessageFn, cb);
            }
          } else {
            this.logger.debug(`No match for watched board ${board.id}`);
          }
        })
        .catch((e) => {
          // To do -- check for failed lookups..probably don't want an error here
          this.logger.error(`boardNotifications.processNewIssueNotifications: Filter: ${jqlUrl} lookup failed: ` +
          `${e.message}.  ${board.bots.length} bots may have missed notifications.`);
        });
      });
    } catch (e) {
      return Promise.reject(new Error(
        `boardTransitions.processNewIssueNotifications() caught exception: ${e.message}`
      ))
    }
  }

  /**
   * Modify a JQL URL so that it only returns results that
   * match the key for the current issue
   * 
   * @param {string} searchUrl -- the jql associated with the board
   * @param {string} key - this issue key being checked
   */
  updateJQLForThisIssue(searchUrl, key) {
    let newUrl = searchUrl;
    // Remove any "ORDER BY" rules at the end
    let idx = newUrl.indexOf('+ORDER+BY');
    if (idx != -1) {
      newUrl = newUrl.slice(0, idx);
    }
    // Wrap the current JQL, which starts after the "=" in parens
    idx = newUrl.indexOf('=') + 1;
    newUrl = newUrl.slice(0, idx) + '(' + newUrl.slice(idx) + ')';
    // Add URL encoded JQL that the key must match our key
    newUrl += `+AND+(key+%3D+${key})`;

    return newUrl;
  }



 /**
  * Send a message to all bots associated with board
  * @param {object} board - board that new issue matches
  * @param {object} msgElements - relevent info from jira event
  * @param {string} msg - msg to sent to interested spaces
  * @param {function} sendMessageFn -- parent object method for sending message
  * @param {function} cb -- callback for testing framework 
  */ 
  notifyAllBotsWatchingBoard(board, msgElements, msg, sendMessageFn, cb) {
    board.bots.forEach(bot => {
      this.logger.info('Sending a new issue notification to ' + bot.room.title + ' about ' + msgElements.issueKey);
      sendMessageFn(bot, msgElements, msg, cb)
      .catch((e) => {
        this.logger.error(`Failed to send board transition message: ${e.message}`);
      });
    });
  }

  /**
   * Process an Add or Delete Boards button press
   * 
   * @param {object} bot - bot instance in the feedback space
   * @param {object} trigger - frameworks trigger object
   */
  async updateBoardConfig(bot, trigger) {
    try {
      let attachmentAction = trigger.attachmentAction;
      let inputs = attachmentAction.inputs;
      let config = await bot.recall('groupSpaceConfig');
      if ((inputs.boardIdOrUrl) && (inputs.boardType)) {
        // Check if the requested board is already being watched
        let board = _.find(config.boards, board => 
          ((board.id === parseInt(inputs.boardIdOrUrl)) &&
           (board.type === inputs.boardType))); 
        if (!board) {
          board = _.find(config.boards, board => board.viewUrl === inputs.boardIdOrUrl);  
        }
        if (board) {
          return bot.reply(attachmentAction,
            `I'm already watching [${board.name}](${board.viewUrl}) for this space`);
        }
        // For extra security, only let jira users add new boards to the space
        return this.jira.lookupUser(trigger.person.emails[0])
        .then(() => {
          return bot.reply(attachmentAction, 
            `Looking up info for ${inputs.boardType}: ${inputs.boardIdOrUrl}.  This can take several minutes....`)
            .then(() => this.watchBoardForBot(bot, inputs.boardIdOrUrl, inputs.boardType))
            .then((board) => {
              config.boards.push(board);
              return bot.store('groupSpaceConfig', config);
            })
            .then(() => this.groupStatus.postSuccessCard(bot))
            .catch((e) => {
              this.logger.error(`Failed setting up a new board in space "${bot.room.title}": ${e.message}`);
              this.logger.error(`trigger from card: ${JSON.stringify(trigger, null, 2)}`);
              return bot.reply(trigger.attachmentAction, e.message);
            });
          })
          .catch(e => {
            this.logger.info(`Refusing request to add a board from non jira user ${trigger.person.emails[0]}. jira.lookupUser returned: ${e.message}`);
            return bot.reply(attachmentAction, `Sorry, only users with a Jira account can modify my settings`);
          });
      } else if (inputs.boardsToDelete) {
        // process request to stop waching boards
        return this.deleteBoardsForBot(bot, inputs.boardsToDelete, config, attachmentAction)
        .then(() => this.groupStatus.postSuccessCard(bot))
        .catch((e) => {
          this.logger.error(`Failed removing board(s): ${input.boardsToDelete} in space "${bot.room.title}": ${e.message}`);
          this.logger.error(`Current config: ${JSON.stringify(config, null, 2)}`);
            return bot.reply(attachmentAction,
              `Error removing board(s): ${input.boardsToDelete} ${e.message}\n\n` +
              `Current notification state is unclear.  Please send me a help message`);
        });
    } else {
        this.logger.error(`updateBoardConfig error: Did not see any expected input from card in space "${bot.room.title}"`);
        this.logger.error(`inputs from card: ${JSON.stringify(inputs, null, 2)}`);
        return bot.reply(trigger.attachmentAction,
          `Got an unexpected input.  Error logged`);
      }
    } catch (e) {
      this.logger.error(`updateBoardConfig error: processing input from card in space "${bot.room.title}": ${e.message}`);
      return bot.reply(trigger.attachmentAction,
        `Something unexpected went wrong with adding board. Error logged.`);
    }
  }

  /** 
   * Remove (a) board(s) from the set that a bot is watching
   * 
   * If this is the only bot watching this board remove it from the list that gets
   * a cache refresh
   * 
   * @function deleteBoardsForBot
   * @param {object} bot - bot object for space requesting board notifications
   * @param {string} boardIdObjs - a comma seperated list of boardId:boardType pairs to delete
   * @param {object} config - board's configuration object
   * @param {object} attachmentAction - attachmentAction that caused this
   * @returns {Promise.<Object>} - a public board object with id, name, and num of stories
   */
  deleteBoardsForBot(bot, boardIdObjs, config, attachmentAction) {
    let boardIds = boardIdObjs.split(',');
    boardIds.forEach((boardIdString) => {
      let boardInfo = boardIdString.split(':')
      let boardId = parseInt(boardInfo[0]);
      let boardType = boardInfo[1];
      // Is this a board this bot is watching?
      let index = config.boards.findIndex(board => 
        ((board.id === boardId) && (board.type === boardType)))
      if (index >= 0) {
        let boardInfo = _.find(this.boardsInfo, board => 
          ((board.id === boardId) && (board.type === boardType)))
          if (boardInfo) {
          let botIndex = boardInfo.bots.findIndex(b => b.id === bot.id);
          if (botIndex >= 0) {
            boardInfo.bots.splice(botIndex, 1)
            if (!boardInfo.bots.length) {
              this.logger.info(`bot in space "${bot.room.title}" asked to stop watching ${boardType} ` +
              `with ID ${boardId}. This is the last bot watching this ${boardType} so we will remove ` +
              `it from the list of ${boardType}s we are caching info for.`);
              this.boardsInfo = _.reject(this.boardsInfo, board => 
                ((board.id === boardId) && (board.type == boardType)));
            }
          } else {
            this.logger.warn(`bot in space "${bot.room.title}" asked to stop watching ${boardType}` +
            `with ID ${boardId}, but the bot is missing from the list of bots watching it.  Ignoring.`);
          }
        }
        config.boards.splice(index, 1)
      } else {
        this.logger.warn(`bot in space "${bot.room.title}" asked to stop watching ${boardType}` +
          ` with ID ${boardId}, but it is not in the config.  Ignoring.`);
      }
    });
    return bot.store('groupSpaceConfig', config);
  }
    
  /**
   * Send notfications to all appropriate spaces
   * 
   * @private
   * @param {object} msgElement - the data needed to create a notification for this jira event
   * @param {array} boards - list of watched boards that the transition occured on
   * @param {function} sendMessageFn - parent class funtion to send the message
   * @param {function} cb - the (optional) callback function used by the test framework
   */
  notifyTransitionSpaces(msgElements, boards, sendMessageFn, cb) {
    let issue = msgElements.jiraEvent.issue;
    let msg = `${msgElements.author} transitioned a(n) ${msgElements.issueType} from ` +
      `${msgElements.updatedFrom} to ${msgElements.updatedTo}`;
    if ((msgElements.updatedTo) && (issue?.fields?.resolution?.name)) {
      msg += `, Resolution:${issue.fields.resolution.name}`
    }
    msg += `:\n* [${msgElements.issueKey}](${msgElements.issueUrl}): ${msgElements.issueSummary}\n`;
  
    if (issue?.fields?.components?.length) {
      msg += '   * Components: ';
      for (let i=0; i<issue.fields.components.length; i++) {
        msg += `${issue.fields.components[i].name}, `;
      }
      // remove dangling comma and space
      msg = msg.substring(0, msg.length - 2);
    }
  
    if (issue?.fields?.customfield_11800?.value) {
      msg += `\n   * Team/PT: ${issue.fields.customfield_11800.value}`;
      if ((typeof issue.fields.customfield_11800.child === 'object') && (issue.fields.customfield_11800.child.value)) {
        msg += `: ${issue.fields.customfield_11800.child.value}`;
      }
    }
  
    boards.forEach((board) => {
      let boardMsg = msg;
      if (board.type === 'filter') {
        boardMsg += `\n\nWhich matches the filter: [${board.name}](${board.viewUrl})`;
      } else {
        boardMsg += `\n\nOn the ${board.type} [${board.name}](${board.viewUrl})`;
      }
      this.notifyAllBotsWatchingBoard(board, msgElements, boardMsg, sendMessageFn, cb);
    });
  }
  
  /**
   * Is issue on a board we are watching
   * 
   * @function issueOnWatchedBoard
   * @param {string} key - issue key for TR Notification candidate
   * @return {object} - array of boards that have the issue on them
   */
  issueOnWatchedBoard(key) {
    return this.boardsInfo.filter(boardInfo => {
      return (-1 != boardInfo.stories.indexOf(key));
    }); 
  }

  /**
   * Update the cached list of stories for a list of boardsInfo
   * 
   * While we attempt to keep our cache current by checking each new issue against
   * the JQL query associated with each board we refresh periodically in cases
   * any were missed.   This is also necessary in cases where the filter
   * query associated with a board was changed
   * 
   * @private
   * @function updateStoriesForBoards
   * @param {Array} boardsInfo - list of board info objects 
   * @returns {Promise.Array} - if resolved all board objects have updated story lists
   */
  updateStoriesForBoards(boardsInfo) {
    return Promise.all(boardsInfo.map(board => {
      let numStoriesInCache = board.stories.length
      return this.jira.lookupListByIdAndType(board.id, board.type)
      .then((newBoard) => {
        if (newBoard.searchUrl !== board.searchUrl) {
          this.logger.info(`${board.type} ${board.id} has changed since it was last cached`);
          // Capture the aspects of the board changes that are relevant to our bot
          board.searchUrl = newBoard.searchUrl;
          board.jql = newBoard.jql;
        }
      return this.jira.lookupAndStoreListIssues(board)
    })
    .then((board) => {
          if (numStoriesInCache !== board.stories.length) {
            this.logger.info(`${board.type} ${board.id} stories have changed since last cache update.`);
          }
        })
        .catch(e => {
          this.logger.error(`updateStoriesForBoard: Failed getting stories for board ${board.id}: ${e.message}`);
          return Promise.reject(e);
        });
    }))
  }

  /**
   * Add the info for a new board to the set of boards we are tracking
   * If this is the first board that has been requested since our 
   * service started, configure the cache refresh timer
   * 
   * @private
   * @function addBoardToWatchedSet
   * @param {Object} board - board info object to be added to the list
   */
  addBoardToWatchedSet(board) {
      if (!this.boardsInfo.length) {
        // If this is the first board, set up periodic cache refresh
        setInterval(() => {
          this.logger.info(`Updating cache of stories for boards that we are notifiying about...`)
          this.updateStoriesForBoards(this.boardsInfo)
            .then(() => {
              this.logger.info(`Transition Board stories cache update complete.`);
              this.lastCacheUpdate = new Date().toUTCString();
            }).catch(e => {
              this.logger.error(`failed getting issues for transition boards: ${e.message}`);
              this.logger.error(`Will use existing cache of eligible transition ` +
                        `stories and attempt to refresh again in ${this.boardCacheDuration/1000} seconds`);
            });
        }, this.boardCacheDuration);
      }
      // Check if this board already exists in the list
      // Warn if so...this shouldn't happen!
      let dupBoard = _.find(this.boardsInfo, b => board.id === b.id); 
      if (dupBoard) {
        this.logger.warn(`BoardID ${board.id} is now set up, but it is already in our configuration!`);
        this.logger.warn(`This should not happen.  Will recover by getting rid of the old one`);
        board.bots = dupBoard.bots;
        this.boardsInfo = _.reject(this.boardsInfo, {'id': dupBoard.id});
      }
      // Now add our new board
      this.boardsInfo.push(board)
    };

  /**
   * Add a bot to the list of spaces wanting notifications for 
   * a board (ie: a board or a filter)
   * Don't add if it already exists
   * 
   * @private
   * @function addBotToBoardInfo
   * @param {Object} bot - bot for space to be notified of transitions
   * @param {Object} board - board info object for desired board
   */
  addBotToBoardInfo(bot, board) {
      if (!('bots' in board)) {
        return board.bots = [bot];
      }
      let dupBot = _.find(board.bots, b => b.id === bot.id);
      if (!dupBot) {
        board.bots.push(bot);
      }
      // No warning if this IS a duplicate.  There are scenarios where
      // multiple bots could ask for the same board before it is fully cached
      // In these cases its possible that the logic that cleans up the 
      // pending bot queue could try to push a pending bot after it was
      // already added in the list callback
      // This probably could be optimized to not happen...but it causes no harm
    };
  
  /**
   * Returns an object with the current board stats
   * 
   * This can be used to support Admin commands to get details on this
   * features usage
   * 
   * @function getCurrentBoardStats
   * @returns {Object} an object that describes the current board info
   */
  getCurrentBoardStats() {
    let boardStats = {
      boards: [],
      cacheDuration: this.boardCacheDuration
    };
    this.boardsInfo.forEach(board => {
      let publicBoard = {
        id: board.id,
        type: board.type,
        name: board.name,
        numStories: board.stories.length,
        bots: []
      };
      board.bots.forEach(bot => {
        publicBoard.bots.push({
          id: bot.id,
          title: bot.room.title
        })
      });
      boardStats.boards.push(publicBoard);
    });
    return boardStats;
  }

  /**
   * Process a request to show board stats to the admin space
   *
   * @param {object} adminsBot - bot object to post stats to 
   */
  showAdminBoardInfo(adminsBot) {
    let msg = 'Watching the following boards and filters:\n';
    this.boardsInfo.forEach((board) => {
      msg += `* ${board.type}: [${board.name}](${board.viewUrl}) with ${board.stories.length} stories:\n`;
      board.bots.forEach((bot) => {
        msg += `  * watched in space: "${bot.room.title}\n`;
      });
      if (msg.length >= 5000) {
        adminsBot.say(msg);
        msg = 'Also watching these boards and filters:\n';
      }
    });
    let summary = `For a total of ${this.boardsInfo.length} boards and filters.`;
    if (-1 != msg.indexOf('*')) {
      msg += `\n\n${summary}`
    } else {
      msg = summary;
    }
    if (this.lastCacheUpdate) {
      msg += `\n\n The cache was last updated ${this.lastCacheUpdate}`;
    } else {
      msg += `\n\n The cache has not updated since the bot restarted.`;
    }
    adminsBot.say(msg);
  }
  

}

module.exports = BoardTransitions;

/**
 * Recursively call until a particular bot/boardId pair is no longer in the 
 * pending list
 * 
 * @private
 * @function returnWhenNotPending
 * @param {function} resolveFn - method to resolve promise when bot is not pending
 * @param {function} rejectFn - method to reject promise if timout occurs
 * @param {Array} pendingList - list of bot/board pairs still pending
 * @param {Integer} boardIdObj - boardIdObj to match
 * @param {Object} bot - bot to match
 * @param {Integer} sleepSeconds - seconds to sleep
 * @param {Object} transitionObj - instance of the boardTransitions object that called
 * @returns {Promise.Array} - returns a public board object when found
 */
returnWhenNotPending = function (resolvedFn, rejectFn, pendingList, boardIdObj, 
  bot, sleepSeconds, transitionObj, numTries=0) 
{
  numTries += 1;
  let botListPair = _.find(pendingList, pair => {
    return ((pair.boardIdObj.id === boardIdObj.id) && 
      (pair.boardIdObj.type === boardIdObj.type) &&
      (pair.bot.id === bot.id));
  });

  if (!botListPair) {
    let boardInfo = transitionObj.getPublicBoardInfo(boardIdObj);
    return resolvedFn(boardInfo);
  }
  if (numTries >= 10) {
    let msg = `Failed initializing ${boardIdObj.type}:${boardIdObj.id}. ` +
     `List of stories not available after ${numTries*sleepSeconds} seconds.`;
    transitionObj.logger.warn(`In space ${bot.room.title}: ${msg}`);
    transitionObj.pendingBotAdds = _.reject(pendingList, b => 
      ((b.boardIdObj.id ===boardIdObj.id) && (b.boardIdObj.type === boardIdObj.type) &&
       (b.bot.id === bot.id)));
    transitionObj.logger.error(msg);
    let error = new Error(msg);
    error.boardProblemType = 'storiesLookupTimeout';
    return rejectFn(error);
  } else {
    setTimeout(returnWhenNotPending.bind(null, resolvedFn, rejectFn, 
      transitionObj.pendingBotAdds, boardIdObj, bot, sleepSeconds, transitionObj, numTries
    ), sleepSeconds * 1000); // try again after timout
  }
}

