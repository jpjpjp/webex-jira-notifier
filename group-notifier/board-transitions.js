// board-transition.js
/*jshint esversion: 6 */  // Help out our linter
var when = require('when');
var _ = require('lodash');

/**
 * An optional module for the jira notifier bot.
 * When enabled it can track activity on "jira boards"
 * This is one of the types of notifications supported in 
 * group spaces.
 *
 * If an issue is updated, this module can check to 
 * see if the update contitutes a "transition" (status change)
 * and if the issue is on a watched board it can notify 
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
    this.boardIds = [];
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
    .then((boardId) => {
// TEMPORARY UNTIL getIssuesListIdFromViewUrl returns object
listIdType = 'board';
      this.logger.info(`Space "${bot.room.title}" asked to watch listIdObj "${boardId}"`);

      if (-1 != this.boardIds.indexOf(boardId)) {
        // This board has already been requested.  Is it cached?
        let board = _.find(this.boardsInfo, board => board.id === boardId); 
        if (board) {
          this.logger.info(`${boardId}:"${board.name}" already in cache.  Adding this bot to the list of followers.`);
          this.addBotToBoardInfo(bot, board);
          return new Promise((r) => returnWhenNotPending(r, this.pendingBotAdds,boardId, bot, 10, this));
        } else {
          // Board requested but not cached yet, add this bot to the 
          // list of bots to be added to cached info when ready
          this.logger.info(`This board has been requestd but is not yet in cache.  Will add this bot when cache is ready.`);
          this.pendingBotAdds.push({boardId, bot});
          // return when the bot has been added to the boardsId list
          return new Promise((r) => returnWhenNotPending(r, this.pendingBotAdds,boardId, bot, 10, this));
        }
      } else {
        this.logger.info(`This is a new board.  Will validate it and add stories to cache.`);
        this.boardIds.push(boardId);
        this.pendingBotAdds.push({boardId, bot});
//        return this.jira.lookupBoardById(boardId)
        return this.jira.lookupListByIdAndType(boardId, listIdType)
        .then((board) => this.jira.lookupAndStoreListIssues(board))
        .then((board) => {
          this.logger.info(`${boardId} is a valid id: "${board.name}" Added ${board.stories.length} stories to cache.`);
          this.addBotToBoardInfo(bot, board);
          this.addBoardToBoardsInfo(board);
          this.updateBoardInfoWithPendingBots();
          return  new Promise((r) => returnWhenNotPending(r, this.pendingBotAdds,boardId, bot, 10, this));
        })
        .catch(e => {
          this.logger.warn(`watchIssuesListForBot: Failed getting info for board ${boardId}, requested in space "${bot.room.title}": ${e.message}`);
          // remove any pending bots waiting for this board
          this.pendingBotAdds = _.reject(this.pendingBotAdds, {'boardId': boardId});
          this.boardIds = this.boardIds.filter(id => id !== boardId); 
          return when.reject(e);
        });
      }
    })
    .catch((e) => {
      let msg = `Could not find a board matching ${listIdString}`;
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
      let botBoardInfo = this.pendingBotAdds[i];
      let board = _.find(this.boardsInfo, board => board.id === botBoardInfo.boardId); 
      if (board) {
        this.logger.info(`BoardId ${botBoardInfo.boardId} now in cache.  Bot for ${botBoardInfo.bot.room.title} will now notify for its transitions`);
        this.addBotToBoardInfo(botBoardInfo.bot, board);
        this.pendingBotAdds.splice(i, 1);
      }
    }
    this.logger.debug(`After update ${this.pendingBotAdds.length} bots are still waiting for their board to cache`);
  }

  /** 
   * Return the public info about board that a bot might need
   * 
   * @function getPublicBoardInfo
   * @param {string} boardIdString - id of the board bot wants to watch
   */
  getPublicBoardInfo(boardId) {
    let board = _.find(this.boardsInfo, board => board.id === boardId);
    if (board) {
      return {id: board.id, name: board.name, viewUrl: board.viewUrl, numStories: board.stories.length};
    } else {
      this.logger.warn(`getPublicBoardInfo failed to find board with id ${boardId}.  Returning empty object`)
      return {id: boardId, name: "Not Found", numStories: 0};
    }
  } 

  /**
   * Evaluate and potentially notify group spaces about 
   * transitions occuring on watched boards
   * 
   * @param {object} framework -- the framework with the array of active bot objects
   * @param {object} msgElement - the data needed to create a notification for this jira event
   * @param {object} notifier - the jira notifier object
   * @param {function} cb - the (optional) callback function used by the test framework
   */
  evaluateForTransitionNotification(framework, msgElements, notifier, cb) {
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
      let issue = msgElements.jiraEvent.issue;
  
      // We have a status related event.
      // Check if it is one of the projects we care about
      // if ((!config?.projects?.length) || (!issue?.fields?.project?.key) ||
      //   (-1 === config.projects.findIndex(project => issue.fields.project.key.toLowerCase() === project.toLowerCase()))) {
      //   return;
      // }
    
      // We have a status related event for a project we are interested in.
      // Check if it is one of the issue types we care about
      // if ((!config?.issueTypes?.length) || (!issue?.fields?.issuetype?.name) ||
      //   (-1 === config.issueTypes.findIndex(type => issue.fields.issuetype.name.toLowerCase() === type.toLowerCase()))) {
      //   return;
      // }
  
      // Is this a transition to a status that we are monitoring?
      // if ((!config?.statusTypes) || (!msgElements?.updatedTo) ||
      //   (-1 === config.statusTypes.findIndex(status => msgElements.updatedTo.toLowerCase() === status.toLowerCase()))) {
      //     return;
      // }

      // This is a candidate. Is it on any of the boards we are watching?
      if (this.boardsInfo.length) {
        let boards = this.issueOnWatchedBoard(msgElements.issueKey);
        if (boards.length) {
          this.notifyTransitionSpaces(msgElements, boards, cb);
        }
      } 
      
    } catch(e) {
      logger.error(`evaluateForTransitionNotification() caught exception: ${e.message}`);
      notifier.createTestCase(e, msgElements.jiraEvent, framework, 'evaluate-for-tr-error'); 
      return;  
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
      if (inputs.boardIdOrUrl) {
        // Check if the requested board is already being watched
        let board = _.find(config.boards, board => board.id === parseInt(inputs.boardIdOrUrl)); 
        if (!board) {
          board = _.find(config.boards, board => board.viewUrl === inputs.boardIdOrUrl);  
        }
        if (board) {
          return bot.reply(attachmentAction,
            `I'm already watching [${board.name}](${board.viewUrl}) for this space`);
        }
        return bot.reply(trigger.attachmentAction, 
          `Looking up info for board: ${inputs.boardIdOrUrl}.  This can take several minutes....`)
          .then(() => {
            return this.watchIssuesListForBot(bot, inputs.boardIdOrUrl, /* TODO Add type here */)
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
            if (e.boardProblemType = 'lookup') {
              return bot.reply(trigger.attachmentAction,
                `Unable to add board: ${e.message}`);
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
   * @param {string} boardIds - a comma seperated list of board IDs to remove
   * @param {object} config - board's configuration object
   * @param {object} attachmentAction - attachmentAction that caused this
   * @returns {Promise.<Object>} - a public board object with id, name, and num of stories
   */
  deleteBoardsForBot(bot, boardIds, config, attachmentAction) {
    let boardIdList = boardIds.split(',');
    boardIdList.forEach((boardIdString) => {
      let boardId = parseInt(boardIdString);
      let index = config.boards.findIndex(board => board.id === boardId)
      if (index >= 0) {
        let boardInfo = _.find(this.boardsInfo, board => board.id == boardId)
        if (boardInfo) {
          let botIndex = boardInfo.bots.findIndex(b => b.id === bot.id);
          if (botIndex >= 0) {
            boardInfo.bots.splice(botIndex, 1)
            if (!boardInfo.bots.length) {
              this.logger.info(`bot in space "${bot.room.title}" asked to stop watching board` +
              `with ID ${boardId}. This is the last bot watching this board so we will remove` +
              `it from the list of boards we are caching info for.`);
              this.boardsInfo = _.reject(this.boardsInfo, {'id': boardId});
            }
          } else {
            this.logger.warn(`bot in space "${bot.room.title}" asked to stop watching board` +
            `with ID ${boardId}, but the bot is missing from the boardInfo bot array.  Ignoring.`);
          }
        }
        config.boards.splice(index, 1)
      } else {
        this.logger.warn(`bot in space "${bot.room.title}" asked to stop watching board` +
          `with ID ${boardId}, but it is not in the config.  Ignoring.`);
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
   * @param {function} cb - the (optional) callback function used by the test framework
   */
  notifyTransitionSpaces(msgElements, boards, cb) {
    let issue = msgElements.jiraEvent.issue;
    let msg = `${msgElements.author} transitioned a(n) ${msgElements.issueType} from ` +
      `${msgElements.updatedFrom} to ${msgElements.updatedTo}`;
    if ((msgElements.updatedTo) && (issue?.fields?.resolution?.name)) {
      msg += `, Resolution:${issue.fields.resolution.name}`
    }
    msg += `:\n* [${msgElements.issueKey}](${msgElements.issueUrl}): ${msgElements.issueSummary}\n`;
  
    if (issue?.fields?.components?.length) {
      msg += '* Components: ';
      for (let i=0; i<issue.fields.components.length; i++) {
        msg += `${issue.fields.components[i].name}, `;
      }
      // remove dangling comma and space
      msg = msg.substring(0, msg.length - 2);
    }
  
    if (issue?.fields?.customfield_11800?.value) {
      msg += `\n* Team/PT: ${issue.fields.customfield_11800.value}`;
      if ((typeof issue.fields.customfield_11800.child === 'object') && (issue.fields.customfield_11800.child.value)) {
        msg += `: ${issue.fields.customfield_11800.child.value}`;
      }
    }
  
    boards.forEach((board) => {
      // TODO - make this a link.  Need to find the web URL for the board
      // during setup and add it to the board object
      let boardMsg = msg += `\n\nOn the board: ${board.name}`;
      board.bots.forEach((bot) => {
        bot.say({markdown: boardMsg});
        if (cb) {cb(null, bot);}
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
    return Promise.all(boardsInfo.map(board => {
      return this.jira.getStoriesForBoardUrl(board.self)
        .then((stories) => {
          if (board.stories.length !== stories.length) {
            this.logger.info(`boardID ${board.id} stories have changed since last cache update.`);
          }
          // Copy the new list of stories to the board object
          board.stories = stories
        })
        .catch(e => {
          this.logger.error(`updateStoriesForBoard: Failed getting stories for board ${board.id}: ${e.message}`);
          return Promise.reject(e);
        });
    }))
  }

  /**
   * Recursively fetch all the stories for a given board
   * 
   * @private
   * @function getStorysForBoard
   * @param {string} url - url to get stories from
   * @param {Object} options - request options
   * @returns {Promise.Array} - returns array with user stories
   */
  getStoriesForABoard(url, options, stories) {
    return request.get(this.convertForProxy(url), options)
      .then(issuesListObj => {
        if (!stories) {
          stories = [];
        }
        if (issuesListObj.total) {
          stories = stories.concat(issuesListObj.issues);
        }
        if (issuesListObj.issues.length === issuesListObj.maxResults) {
          options.qs = {startAt: stories.length};
          this.logger.debug(`Fetching eligible transtion stories from ${url}/?startAt=${stories.length}`);
          return this.getStoriesForABoard(url, options, stories);
        }
        return stories;
      });
  }

  /**
   * Recursively fetch all the stories for a given board
   * 
   * @private
   * @function getStorysForBoard
   * @param {string} url - url to get stories from
   * @param {Object} options - request options
   * @returns {Promise.Array} - returns array with user stories
   */
  getStoriesForABoard(url, options, stories) {
    return request.get(this.convertForProxy(url), options)
      .then(issuesListObj => {
        if (!stories) {
          stories = [];
        }
        if (issuesListObj.total) {
          stories = stories.concat(issuesListObj.issues);
        }
        if (issuesListObj.issues.length === issuesListObj.maxResults) {
          options.qs = {startAt: stories.length};
          this.logger.debug(`Fetching eligible transtion stories from ${url}/?startAt=${stories.length}`);
          return this.getStoriesForABoard(url, options, stories);
        }
        return stories;
      });
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
   * Add a bot to the list of spaces wanting notifications for a board
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
 * @param {Array} pendingList - list of bot/boards still pending
 * @param {Integer} boardId - boardId to match
 * @param {Object} bot - bot to match
 * @param {Integer} sleepSeconds - seconds to sleep
 * @param {Object} transitionObj - instance of the boardTransitions object that called
 * @returns {Promise.Array} - returns a public board object when found
 */
returnWhenNotPending = function (resolvedMethod, pendingList, boardId, bot, sleepSeconds, transitionObj) {
  let botBoardPair = _.find(pendingList, pair => {
    return ((pair.boardId === boardId) && (pair.bot.id === bot.id));
  });

  if (!botBoardPair) {
    let boardInfo = transitionObj.getPublicBoardInfo(boardId);
    resolvedMethod(boardInfo);
  } else {
    setTimeout(returnWhenNotPending.bind(null,
      resolvedMethod, transitionObj.pendingBotAdds, boardId, bot, sleepSeconds, transitionObj
    ), sleepSeconds * 1000); // try again after timout
  }
}

