// new-issue-notifications.js
/*jshint esversion: 6 */  // Help out our linter
var when = require('when');
var _ = require('lodash');

/**
 * An optional module for the jira notifier bot.
 * When enabled it can notify group spaces when 
 * new jira issues are created that meet certain filter
 * criteria that users in the Webex Group space configured
 * 
 * This is one of the types of notifications supported in 
 * group spaces.
 *
 * If an issue is created, this module can check to 
 * see if meets certain critera which would trigger a notifcation
 * from our bot in certain spaces.
 *
 * @module NewIssueNotifications
 */
class NewIssueNotifications {
  /**
   * NewIssueNotifications constructor
   * 
   * @param {object} jiraConnector -- an instantiated jiraConnector object
   * @param {object} groupStatus -- object for posting cards about config status
   * @param {object} logger - instance to a logging object
   */
  constructor(jiraConnector, groupStatus, logger) {
    // Authenticated Object to call jira APIs
    this.jira = jiraConnector;
    this.groupStatus = groupStatus;
    this.logger = logger;

    this.newIssueFilters = []

    // TODO - read the supported projects from the requirements
    // For each project look up the list of valid componenets
    // TODO - read from the environment a custom field
    // For each project look up the list of valid custom fields
  }

  /** 
   * Register a bot/new issue filter combination to keep track of
   * 
   * Currently we only support one of two projects SPARK/WEBEX
   * Ideally this would be configured by an enviornment parameter
   * 
   * Currently we support ONLY issues where the type is "Bug".  
   * This could easily be made configurable if requested
   * 
   * We require at least one filter.  Currently supported:
   * Components -- comma seperated list of component names.  Only one needs to match
   * Team/PT -- Cisco Specific Custom Component (TODO -- parameterize this)
   *            Only one needs to match
   * 
   * If multiple filters are set they are OR'ed so that only one match will 
   * generate a notification.  This could also potentially be configured
   * if requested.
   * 
   * 
   * @function watchNewIssuesForBot
   * @param {object} bot - bot object for space requesting board notifications
   * @param {string} filterString - a filter ID or view URL
   * @returns {Promise.<Object>} - an object that captures the details of the bot/new-issue filter
   */
  watchNewIssuesForBot(bot, filterString) {
    return this.jira.getIssuesListIdFromViewUrl(filterString, 'filter')
    .then((filterObj) => {
      this.logger.info(`Space "${bot.room.title}" asked to watch a ${filterObj.type}, ID:${filterObj.id}`);
      let listId = filterObj.id;
      let listType = filterObj.type;
      let existingFilter = this.newIssueFilters.find(filter => filter.id === listId);
      // Make a copy of the filter details for the bot 
      if (existingFilter) {
        // This filter has already been requested.  Add this bot to the notify list
        this.addBotToFilter(bot, existingFilter);
      } else {
        this.logger.info(`This is a new ${listType}.  Will validate it.`);
        return this.jira.lookupFilterById(filterObj.id)
        .then((filter) => {
          this.logger.info(`FilterId ${filterObj.id} matches filter ${filter.name}.  Will monitor it for new issues`);
          this.addFilterToList(filter, bot)

          return Promise.resolve(this.getPublicFilterInfo(filter));
        });
      }
    })
    .catch((e) => {
      let msg = `Could not find a filter matching ${filterString}`;
      this.logger.info(`NewIssueNotifier:watchFilterForBot: ${msg}. ` +
        `Requested by bot from spaceID:${bot.room.id}\nError:${e.message}`);
      return when.reject(new Error(`${msg}`));
    });
}


  /** 
   * Register a bot/new issue filter combination to keep track of
   * 
   * Currently we only support one of two projects SPARK/WEBEX
   * Ideally this would be configured by an enviornment parameter
   * 
   * Currently we support ONLY issues where the type is "Bug".  
   * This could easily be made configurable if requested
   * 
   * We require at least one filter.  Currently supported:
   * Components -- comma seperated list of component names.  Only one needs to match
   * Team/PT -- Cisco Specific Custom Component (TODO -- parameterize this)
   *            Only one needs to match
   * 
   * If multiple filters are set they are OR'ed so that only one match will 
   * generate a notification.  This could also potentially be configured
   * if requested.
   * 
   * 
   * @function watchNewIssuesForBot
   * @param {object} bot - bot object for space requesting board notifications
   * @param {object} project - project to look for new issues in
   * @param {string} componentList - comma seperated list of components
   * @param {string} teamPTList - comma seperate list of Team/PTs
   * @returns {Promise.<Object>} - an object that captures the details of the bot/new-issue filter
   */
  oldwatchNewIssuesForBot(bot, project, componentList, teamPtList) {
    // TODO -- add validator functions in the jira connector to ensure that 
    // the proejct, componentList and teamPtList are valid values
    // reject the promist if any of these fail
    let components = componentList.split(/,\s*/);  // Add this to the validator
    let teamPtStrings = teamPtListsplit(/,\s*/);  // Add this to the validator
    let teamPts = [];
    teamPtStrings.forEach(teamPt => {
      teamInfo = teamPt.split(/\s*:\s*/)
      teamPts.push({
        team: teamInfo[0],
        pt: teamInf[1]
      })
    })
    let newIssueConfig = {
      project,
      components,
      teamPts
    };
    let botConfig = _.find(this.newIssueConfigs, bConfig =>
      (bConfig.bot.id == bot.id));
    if (botConfig) {
      // This bot already has some new issue configs.  Add this to the list
      botConfig.newIssueConfigs.push(newIssueConfig);
    } else {
      // Add this new bot and config pair to the list we check for
      this.newIssueConfigs.push({bot, newIssueConfigs: [newIssueConfig]});
    }
    return Promise.resolve(newIssueConfig);
  }

  /**
   * Evaluate and potentially notify group spaces about 
   * new issues being created
   * 
   * @param {object} msgElement - the data needed to create a notification for this jira event
   * @param {function} createMessageFn -- function to create a jira event notification message
   * @param {function} sendMessagFn -- the groupNotifier objects method to post about events
   * @param {function} cb - the (optional) callback function used by the test framework
   */
  evaluateForNewIssueNotifications(msgElements, createMessageFn, sendMessageFn, cb) {
    try {
      // Is this issue event a New Issue Notification candidate?
      if (msgElements.jiraEvent.webhookEvent !== 'jira:issue_created') {
        return;
      }

      // We have a new issue, lets see if any spaces want to be notified about it
      this.logger.debug(`evaluateForNewIssueNotifications: Got an issue created ` +
        `event for ${msgElements.issueKey}.  Checking if it matches any watched filters...`);
      this.newIssueFilters.forEach(filter => {
        // Add this issues key to the JQL Query
        let jqlUrl = this.updateJQLForThisIssue(filter.searchUrl, msgElements.issueKey);
        return this.jira.getStoriesFromUrl(jqlUrl)
        .then((stories) => {
          if (stories.length > 1) {
            this.logger.error(`evaluateForNewIssueNotifications: Filter: ${jqlUrl} lookup ` +
            `returned ${stories.length} stories.  Expected or 1.  Ignoring`);
          }
          if (stories.length === 1) {
            if (stories[0].key != msgElements.issueKey) {
              this.logger.error(`evaluateForNewIssueNotifications: Filter: ${jqlUrl} lookup ` +
              `returned ${stories[0].key}.  Expected ${msgElements.key}.  Ignoring`);
            } else {
              // time to notify
              let msg = createMessageFn(msgElements, null/* bot.isDirectTo */, this.jira)
              filter.bots.forEach(bot => {
                this.logger.info('Sending a new issue notification to ' + bot.room.title + ' about ' + msgElements.issueKey);
                sendMessageFn(bot, msgElements, msg, cb)
                .catch((e) => {
                  this.logger.error(`Failed to send board transition message: ${e.message}`);
                });
              });
            }
          } else {
            this.logger.debug(`No match for watched filter ${filter.id}`);
          }
        })
        .catch((e) => {
          // To do -- check for failed lookups..probably don't want an error here
          this.logger.error(`evaluateForNewIssueNotifications: Filter: ${jqlUrl} lookup failed: ` +
          `${e.message}.  ${filter.bots.length} bots may have missed notifications.`);
        });
      });
    } catch (e) {
      return Promise.reject(new Error(
        `evaluateForNewIssueNotifications() caught exception: ${e.message}`
      ))
    }
  }

/**
   * Modify a JQL URL so that it only returns results that
   * match the key for the current issue
   * 
   * @param {string} searchUrl -- the jql associated with the filter
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
      let boardMsg = msg;
      if (board.type === 'filter') {
        boardMsg += `\n\nWhich matches the filter: [${board.name}](${board.viewUrl})`;
      } else {
        boardMsg += `\n\nOn the ${board.type} [${board.name}](${board.viewUrl})`;
      }
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
   * Add a bot to the list of spaces wanting notifications for 
   * when a new issue matches a watched filter
   * Don't add if it already exists
   * 
   * @private
   * @function addBotToFilter
   * @param {Object} bot - bot for space to be notified about a new issue
   * @param {Object} filter - filter info object to notify for
   */
  addBotToFilter(bot, filter) {
    if (!('bots' in filter)) {
      return filter.bots = [bot];
    }
    let dupBot = _.find(filter.bots, b => b.id === bot.id);
    if (!dupBot) {
      return filter.bots.push(bot);
    }
    this.logger.warn(`Was asked to add bot for space "${bot.room.title}" ` +
      `to the list of bots notified when a new issue matches filterId: `+
      `${filter.id}, but it already exists.  Ignoring request`);
  }

  /**
   * Add a filter to the list of filters we are watching for new issues
   * Don't add if it already exists
   * 
   * @private
   * @function addFilterToList
   * @param {Object} filter - filter info object to monitor
   * @param {Object} bot - bot to monitor it for
   */
  addFilterToList(filter, bot) {
    let dupFilter = _.find(this.newIssueFilters, f => f.id === filter.id);
    if (!dupFilter) {
      this.addBotToFilter(bot, filter);
      return this.newIssueFilters.push(filter);
    }
    // No warning here as this can happen if multiple bots request the same
    // filter at roughly the same time
    this.addBotToFilter(bot, dupFilter);
  }

  /** 
   * Return the public info about filter that a bot might need
   * 
   * @function getPublicFilterInfo
   * @param {string} filterObj - list id/type bot wants to watch
   */
  getPublicFilterInfo(filterObj) {
      return {id: filterObj.id, type: filterObj.type, name: filterObj.name, viewUrl: filterObj.viewUrl};
  } 


  
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

module.exports = NewIssueNotifications;

