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
 * If an issue is updated, this module can check to 
 * see if the update contitutes a "transition" (status change)
 * and if the issue is on a watched list/board it can notify 
 * the group space that requested updates on the board
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
   * @param {integer} cacheDuration -- optional time to refresh board lookup (default is six hours)
   */
  constructor(jiraConnector, groupStatus, logger, cacheDuration=null) {
    // Authenticated Object to call jira APIs
    this.jira = jiraConnector;
    this.groupStatus = groupStatus;
    this.logger = logger;
    // Check if our bot was configured with a Transition Board Cache Duration
    this.boardCacheDuration = (cacheDuration) ? cacheDuration : 6 * 60 * 60 * 1000;  // six hours
    // Boards to cache on startup
    this.listIdObjs = [];
    this.boardsInfo = [];
    this.pendingBotAdds = [];
  }

  /** 
   * Register a bot/board combination to keep track of
   * 
   * If the board has already been looked up and is in cache, the bot is added to
   * 
   * @function watchIssuesListForBot
   * @param {object} bot - bot object for space requesting board notifications
   * @param {string} listIdString - id of or web url to the list the bot wants to watch
   * @param {string} listIdType - optional, type of list (ie: board, filter)
   * @returns {Promise.<Object>} - a public list object with id, type, name, and num of stories
   */
  watchIssuesListForBot(bot, listIdString, listIdType = null) {
    return this.jira.getIssuesListIdFromViewUrl(listIdString, listIdType)
    .then((listIdObj) => {
      this.logger.info(`Space "${bot.room.title}" asked to watch a ${listIdObj.type}, ID:${listIdObj.id}`);
      let listId = listIdObj.id;
      let listType = listIdObj.type;

      if (-1 != this.listIdObjs.findIndex(idObj =>
        ((idObj.id == listId) && (idObj.type == listType)))) {
        // This board has already been requested.  Is it cached?
        let list = _.find(this.boardsInfo, list => 
          ((list.id === listId) && (list.type === listType))); 
        if (list) {
          this.logger.info(`${listType} ${listId}:"${list.name}" already in cache.  Adding this bot to the list of followers.`);
          this.addBotToListInfo(bot, list);
          // TODO update NotPending logic to check for type as well as id
          return new Promise((r) => returnWhenNotPending(r, this.pendingBotAdds,listIdObj, bot, 10, this));
        } else {
          // List requested but not cached yet, add this bot to the 
          // list of bots to be added to cached info when ready
          this.logger.info(`This ${listType} has been requestd but is not yet in cache.  Will add this bot when cache is ready.`);
          // TODO update Pending logic to check for type as well as id
          this.pendingBotAdds.push({listIdObj, bot});
          // return when the bot has been added to the boardsId list
          // TODO update Pending logic to check for type as well as id
          return new Promise((r) => returnWhenNotPending(r, this.pendingBotAdds,listIdObj, bot, 10, this));
        }
      } else {
        this.logger.info(`This is a new ${listType}.  Will validate it and add stories to cache.`);
        this.listIdObjs.push(listIdObj);
          // TODO update Pending logic to check for type as well as id
          this.pendingBotAdds.push({listIdObj, bot});
//        return this.jira.lookupBoardById(boardId)
        return this.jira.lookupListByIdAndType(listId, listType)
        .then((list) => this.jira.lookupAndStoreListIssues(list))
        .then((list) => {
          this.logger.info(`${listId} is a valid ${listType}: "${list.name}" Added ${list.stories.length} stories to cache.`);
          this.addBotToListInfo(bot, list);
          this.addBoardToBoardsInfo(list);
          // TODO update Pending logic to check for type as well as id
          this.updateBoardInfoWithPendingBots();
          return  new Promise((r) => returnWhenNotPending(r, this.pendingBotAdds,listIdObj, bot, 10, this));
        })
        .catch(e => {
          this.logger.warn(`watchIssuesListForBot: Failed getting info for ${listType}:${listId}, requested in space "${bot.room.title}": ${e.message}`);
          this.pendingBotAdds = _.reject(this.pendingBotAdds, b => 
            ((b.listIdObj.id ===listIdObj.id) && (b.listIdObj.type === listIdObj.type) &&
              (b.bot.id === bot.id)));
          this.listIdObjs = this.listIdObjs.filter(idObj => 
            (!((idObj.id == listId) && (idObj.type == listType)))); 
          return when.reject(e);
        });
      }
    })
    .catch((e) => {
      let type = (listIdType) ? listIdType : 'board or filter';
      if (typeof listIdObj === 'object') {type = listIdObj.type;}
      let msg = `Could not find a ${type} matching ${listIdString}`;
      this.logger.info(`BoardTransition:watchIssuesListForBot: ${msg}. ` +
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
      let botListInfo = this.pendingBotAdds[i];
      let pendingId = botListInfo.listIdObj.id;
      let pendingType = botListInfo.listIdObj.type;
      let waitingBot = botListInfo.bot;
      let board = _.find(this.boardsInfo, board => 
        ((board.id === pendingId) && (board.type === pendingType))); 
      if (board) {
        this.logger.info(`${pendingType}:${pendingId} now in cache.  Bot for ${waitingBot.room.title} will now notify for its transitions`);
        this.addBotToListInfo(waitingBot, board);
        this.pendingBotAdds.splice(i, 1);
      }
    }
    this.logger.debug(`After update ${this.pendingBotAdds.length} bots are still waiting for their board to cache`);
  }

  /** 
   * Return the public info about board that a bot might need
   * 
   * @function getPublicBoardInfo
   * @param {string} listIdObj - list id/type bot wants to watch
   */
  getPublicBoardInfo(listIdObj) {
    let board = _.find(this.boardsInfo, board => 
      ((board.id === listIdObj.id) && (board.type === listIdObj.type)))
    if (board) {
      return {id: board.id, type: listIdObj.type, name: board.name, viewUrl: board.viewUrl, numStories: board.stories.length};
    } else {
      this.logger.warn(`getPublicBoardInfo failed to find ${listIdObj.type} with id ${listIdObj.id}.  Returning empty object`)
      return {id: listIdObj.Id, type: listIdObj.type, name: "Not Found", numStories: 0};
    }
  } 

  /**
   * Evaluate and potentially notify group spaces about 
   * transitions occuring on watched boards
   * 
   * @param {object} msgElement - the data needed to create a notification for this jira event
   * @param {function} sendMessageFn - the group notifier objects function to send notifications
   * @param {function} cb - the (optional) callback function used by the test framework
   */
  evaluateForTransitionNotification(msgElements, sendMessageFn, cb) {
    try {
      // No point evaluating if no one is listening...
      if (!this?.boardsInfo?.length) { 
        return;
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
      if ((inputs.listIdOrUrl) && (inputs.listType)) {
        // Check if the requested board is already being watched
        let board = _.find(config.boards, board => 
          ((board.id === parseInt(inputs.listIdOrUrl)) &&
           (board.type === inputs.listType))); 
        if (!board) {
          board = _.find(config.boards, board => board.viewUrl === inputs.listIdOrUrl);  
        }
        if (board) {
          return bot.reply(attachmentAction,
            `I'm already watching [${board.name}](${board.viewUrl}) for this space`);
        }
        return bot.reply(trigger.attachmentAction, 
          `Looking up info for ${inputs.listType}: ${inputs.listIdOrUrl}.  This can take several minutes....`)
          .then(() => {
            return this.watchIssuesListForBot(bot, inputs.listIdOrUrl, inputs.listType)
            .catch((e) => {
              e.boardProblemType = 'lookup';
              return Promise.reject(e);
            });
          })
          .then((board) => {
            config.boards.push(board);
            return bot.store('groupSpaceConfig', config);
          })
          .then(() => this.groupStatus.postSuccessCard(bot))
          .catch((e) => {
            if (e.boardProblemType === 'lookup') {
              return bot.reply(trigger.attachmentAction,
                `Unable to add board: ${e.message}.\n\n` +
                `Make sure the permissions for the ${inputs.listType} allow fall jira users to view it.`);
            }
            this.logger.error(`Failed setting up a new board in space "${bot.room.title}": ${e.message}`);
            this.logger.error(`trigger from card: ${JSON.stringify(trigger, null, 2)}`);
            return bot.reply(trigger.attachmentAction,
              `Something unexpected went wrong with adding board. Error logged.`);
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
   * @param {string} listIdObjs - a comma seperated list of listId:listType pairs to delete
   * @param {object} config - board's configuration object
   * @param {object} attachmentAction - attachmentAction that caused this
   * @returns {Promise.<Object>} - a public board object with id, name, and num of stories
   */
  deleteBoardsForBot(bot, listIdObjs, config, attachmentAction) {
    let listIds = listIdObjs.split(',');
    listIds.forEach((listIdString) => {
      let listInfo = listIdString.split(':')
      let listId = parseInt(listInfo[0]);
      let listType = listInfo[1];
      // Is this a board this bot is watching?
      let index = config.boards.findIndex(board => 
        ((board.id === listId) && (board.type === listType)))
      if (index >= 0) {
        let listInfo = _.find(this.boardsInfo, board => 
          ((board.id === listId) && (board.type === listType)))
          if (listInfo) {
          let botIndex = listInfo.bots.findIndex(b => b.id === bot.id);
          if (botIndex >= 0) {
            listInfo.bots.splice(botIndex, 1)
            if (!listInfo.bots.length) {
              this.logger.info(`bot in space "${bot.room.title}" asked to stop watching ${listType} ` +
              `with ID ${listId}. This is the last bot watching this ${listType} so we will remove ` +
              `it from the list of ${listType}s we are caching info for.`);
              this.boardsInfo = _.reject(this.boardsInfo, board => 
                ((board.id === listId) && (board.type == listType)));
            }
          } else {
            this.logger.warn(`bot in space "${bot.room.title}" asked to stop watching ${listType}` +
            `with ID ${boardId}, but the bot is missing from the list of bots watching it.  Ignoring.`);
          }
        }
        config.boards.splice(index, 1)
      } else {
        this.logger.warn(`bot in space "${bot.room.title}" asked to stop watching ${listType}` +
          ` with ID ${listId}, but it is not in the config.  Ignoring.`);
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
      board.bots.forEach((bot) => {
        this.logger.info('Sending a transition notification to ' + bot.room.title + ' about ' + msgElements.issueKey);
        sendMessageFn(bot, msgElements, boardMsg, cb)
          .catch((e) => {
            this.logger.error(`Failed to send board transition message: ${e.message}`);
          });
      });
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
   * Update the child stories to a list of boardsInfo
   * @private
   * @function updateStoriesForBoards
   * @param {Array} boardsInfo - list of board info objects 
   * @returns {Promise.Array} - if resolved all board objects have updated story lists
   */
  updateStoriesForBoards(boardsInfo) {
    return Promise.all(boardsInfo.map(list => {
      let numStoriesInCache = list.stories.length
      return this.jira.lookupListByIdAndType(list.id, list.type)
      .then((newList) => {
        if ((newList.type === 'filter') && (newList.searchUrl !== list.searchUrl)) {
          this.logger.info(`${list.type} ${list.id} has changed since it was last cached`);
          // Capture the aspects of the list changes that are relevant to our bot
          list.searchUrl = newList.searchUrl;
          list.jql = newList.jql;
        }
      return this.jira.lookupAndStoreListIssues(list)
    })
    .then((list) => {
          if (numStoriesInCache !== list.stories.length) {
            this.logger.info(`${list.type} ${list.id} stories have changed since last cache update.`);
          }
        })
        .catch(e => {
          this.logger.error(`updateStoriesForBoard: Failed getting stories for board ${list.id}: ${e.message}`);
          return Promise.reject(e);
        });
    }))
  }

  /**
   * Add the info for a new board to the list of boards we are tracking
   * If this is the first board requested since our service started 
   * configure the cache refresh timer
   * 
   * @private
   * @function addBoardToBoardsInfo
   * @param {Object} board - board info object to be added to the list
   */
  addBoardToBoardsInfo(board) {
      if (!this.boardsInfo.length) {
        // If this is the first board, set up periodic cache refresh
        setInterval(() => {
          this.logger.info(`Updating cache of stories for boards that we are notifiying about...`)
          this.updateStoriesForBoards(this.boardsInfo)
            .then(boardsWithStories => {
              // ToDo Get the bots for each board
              this.logger.info(`Transition Board stories cache update complete.`);
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
   * a list (ie: a board or a filter)
   * Don't add if it already exists
   * 
   * @private
   * @function addBotToListInfo
   * @param {Object} bot - bot for space to be notified of transitions
   * @param {Object} list - board info object for desired board
   */
  addBotToListInfo(bot, list) {
      if (!('bots' in list)) {
        return list.bots = [bot];
      }
      let dupBot = _.find(list.bots, b => b.id === bot.id);
      if (!dupBot) {
        list.bots.push(bot);
      }
      // No warning if this IS a duplicate.  There are scenarios where
      // multiple bots could ask for the same list before it is fully cached
      // In these cases its possible that the logic that cleans up the 
      // pending bot queue could try to push a pending bot after it was
      // already added in the list callback
      // This probably could be optimized to not happen...but it causes no harm
    };
  
  /**
   * Returns an object with the current board stats
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

}

module.exports = BoardTransitions;

/**
 * Recursively call until a particular bot/boardId pair is no longer in the 
 * pending list
 * 
 * @private
 * @function returnWhenNotPending
 * @param {Promise} resolveMethod - promie to resolve
 * @param {Array} pendingList - list of bot/list pairs still pending
 * @param {Integer} listIdObj - listIdObj to match
 * @param {Object} bot - bot to match
 * @param {Integer} sleepSeconds - seconds to sleep
 * @param {Object} transitionObj - instance of the boardTransitions object that called
 * @returns {Promise.Array} - returns a public board object when found
 */
returnWhenNotPending = function (resolvedMethod, pendingList, listIdObj, bot, sleepSeconds, transitionObj, numTries=0) {
  numTries += 1;
  let botListPair = _.find(pendingList, pair => {
    return ((pair.listIdObj.id === listIdObj.id) && 
      (pair.listIdObj.type === listIdObj.type) &&
      (pair.bot.id === bot.id));
  });

  if (!botListPair) {
    let boardInfo = transitionObj.getPublicBoardInfo(listIdObj);
    resolvedMethod(boardInfo);
  } else if (numTries >= 10) {
    let msg = `Failed initializing ${listIdObj.type}:${listIdObj.id} ` +
     `for bot in space ${bot.room.title}. ` +
     `List of stories not available after ${numTries*sleepSeconds} seconds.`;
    transitionObj.pendingBotAdds = _.reject(pendingList, b => 
      ((b.listIdObj.id ===listIdObj.id) && (b.listIdObj.type === listIdObj.type) &&
       (b.bot.id === bot.id)));
    transitionObj.logger.error(msg);
    let error = new Error(msg);
    error.boardProblemType = 'lookup';
    return resolvedMethod.reject(error);
  } else {
    setTimeout(returnWhenNotPending.bind(null,
      resolvedMethod, transitionObj.pendingBotAdds, listIdObj, bot, sleepSeconds, transitionObj, numTries
    ), sleepSeconds * 1000); // try again after timout
  }
}

