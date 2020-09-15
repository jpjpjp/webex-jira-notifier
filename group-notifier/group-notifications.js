// group-notifications.js
/*jshint esversion: 6 */  // Help out our linter

/**
 * An optional module for the jira notifier bot.
 * By default this bot only sends notifications in 1-1 spaces
 * This module enables different types of configurable
 * notifications in group spaces as well.
 *
 * Note that enabling group space notifications enables the
 * possiblility of exposing jira activity to users who should
 * not have it.  To provide a minimum of security the module
 * will not load if the framework configuration does not include
 * the restrictToEmailDomains option.  This prevents the bot 
 * sending notifications in spaces where users without an allowed
 * email domain are present, but this not not present users
 * in the same company from getting Jira notifications that they
 * are not entitled to.   Use with caution.
 *
 * @module GroupNotifications
 */
class GroupNotifications {
  /**
   * GroupNotifications constructor
   * 
   * @param {object} jiraConnector -- an instantiated jiraConnector object
   * @param {object} logger - instance to a logging object
   * @param {object} frameworkConfig - config object used by framework
   */
  constructor(jiraConnector, logger, frameworkConfig) {
    // Ensure at least one type of group notification is enabled
    if (!((process.env.ENABLE_BOARD_TRANSITION_NOTIFICATIONS) ||
        (process.env.ENABLE_NEW_ISSUE_NOTIFICATIONS))) {    
      throw new Error('Cannot ENABLE_GROUP_NOTIFICATION unless at least one ' +
        'type of group notification is enabled.  Supported types are:\n' +
        ' - ENABLE_BOARD_TRANSITION_NOTIFICATIONS\n' +
        ' - ENABLE_NEW_ISSUE_NOTIFICATIONS\n' +
      'To enable, set the appropriate environment variable.');
    }
    // Only enable if bot use is restricted to certain email domains
    if (!frameworkConfig.restrictedToEmailDomains) {
      throw new Error(`Cannot ENABLE_GROUP_NOTIFICATION if DEFAULT_DOMAIN is not set.` +
       ' This is to prevent notifying non company employees of Jira status');
    }

    this.jira = jiraConnector;
    this.logger = logger;

    // Default data object for group spaces
    this.defaultGroupSpaceConfig = {
      boards: [],
      newIssueNotificationConfig: []
    };

    // Module to builds a status card for group spaces
    var GroupStatus = require('./group-status.js');
    this.groupStatus = new GroupStatus();

    if (process.env.ENABLE_BOARD_TRANSITION_NOTIFICATIONS) {    
      try {
        // Create the object for managing board transition notifications
        var BoardTransitions = require('./board-transitions.js');
        this.boardTransitions = new BoardTransitions(
          this.jira, this.groupStatus, this.logger, 
          parseInt(process.env.BOARD_STORY_CACHE_TIMEOUT), // default is 6 hours
          process.env.JIRA_TRANSITION_BOARDS // any board IDs to load by default
        );
      } catch (err) {
        logger.error('Failure during BoardTransition module initialization: ' + err.message);
        process.exit(-1);
      }
    } else {
      this.boardTransitions = null;
    }

    if (process.env.ENABLE_NEW_ISSUE_NOTIFICATIONS) {    
      try {
        // Create the object for managing new issue notifications
        var NewIssueNotifications = require('./new-issue-notifications.js');
        this.newIssueNotifications = new NewIssueNotifications(
          this.jira, this.groupStatus, this.logger);
      } catch (err) {
        logger.error('Failure during NewIssueNotifications module initialization: ' + err.message);
        process.exit(-1);
      }
    } else {
      this.newIssueNotifications = null;
    }

  }

  
  /**
   * spawn handler for a group spaces
   * 
   * @param {object} bot -- the newly spawned bot
   * @param {object} addedBy - id of user who added bot to space
   * @param {object} adminsBot - bot object for the Admin monitoring this bot
   */
  onSpawn(bot, addedBy, adminsBot) {
    if (!((process.env.ENABLE_BOARD_TRANSITION_NOTIFICATIONS) ||
        (process.env.ENABLE_NEW_ISSUE_NOTIFICATIONS))) {    
      // If this group-notification module was instantiated this
      // should never happen, but just in case...
      logger.info(`Leaving Group Space: ${bot.room.title}`);
      bot.say("Hi! Sorry, I only work in one-on-one rooms at the moment.  Goodbye.")
        .finally(() => {
          bot.exit();
          if (adminsBot) {
            adminsBot.say(`${botName} left the group space "${bot.room.title}"`)
              .catch((e) => logger.error(`Failed to update to Admin about a new space our bot left. Error:${e.message}`));
          }
        });
      return;
    }

    // Check if our bot is in the "Ask Notifier" space.  If so enable feedback
    if ((process.env.ASK_SPACE_ROOM_ID) && (!this.groupStatus.getFeedbackSpaceBot())) {
      if (bot.room.id === process.env.ASK_SPACE_ROOM_ID) {
        this.groupStatus.setFeedbackSpaceBot(bot);
      }
    }

    if (addedBy) {
      // This is a new group space bot.  Store the default config in
      // and post instructions to the users of the space
      //this.postGroupSpaceInstructions(bot, /*show_status=*/false, /*show_instructions=*/true);
      bot.store('groupSpaceConfig', this.defaultGroupSpaceConfig)
      .then(()=> {
        this.groupStatus.postStatusCard(bot, this.defaultGroupSpaceConfig)
          .catch(e => {
            this.logger.error(`Failed to post initial group space status message in space "${bot.room.title}": ${e.message}`);
          })

        // Develoment debugging only
        // this.boardTransitions.watchIssuesListForBot(bot, '4263');
      })
      .catch(e => {
        this.logger.error(`Failed to store group space config in new space with ${bot.room.id}: ${e.messages}`);
      });
    } else {
      bot.recall('groupSpaceConfig')
      .then((config) => {
        if (config?.boards?.length) {
          config.boards.forEach(board => {
            this.boardTransitions.watchIssuesListForBot(bot, board.id, board.type);
          })
        }
        // ToDo handle new issue notification configurations
      })
      .catch(e => {
        this.logger.error(`Unable to lookup config for group space ${bot.room.id}: ${e.message}`);
        // ToDo, how can the user better recover from this?
        bot.say('I cannot find any notificaiton configurations for this space!')
      })
    }
  }

  /**
   * despawn handler for a group spaces
   * 
   * @param {object} bot -- the newly spawned bot
   */
  onDespawn(bot) {
    // Check if our bot has left the "Ask Notifier" space.  If so disable feedback
    if (bot.room.id === process.env.ASK_SPACE_ROOM_ID) {
      this.groupStatus.setFeedbackSpaceBot(null);
    }
  }

  /**
   * Post instructions for a group space
   * 
   * @param {object} bot -- bot to post instructions
   * @param {boolean} show_status - if set show only status
   * @param {boolean} show_instructions - if set show only instructions
   * @param {object} group_config - if available use for status update
   */
  async postGroupSpaceInstructions(bot, show_status = false, show_instructions = true, group_config = null) {
    if (bot.isDirect) {
      this.logger.error(`postGroupSpaceInstructions called with direct bot object!`);
      return;
    }
    try {
      if (show_status) {
        let config = group_config;
        if (!config) {
          config = await bot.recall('groupSpaceConfig')
        }
        let also = '';
        let msg = '';
        if (config?.boards?.length) {
          msg = 'I will send notifications to this space transitions on these boards:\n';
          config.boardIds.forEach((board) => {
            msg += `* ${board.name}\n`
          });
          msg += '\n';
          also = 'also ';
        }
        // Todo review after implementation
        if (config?.newIssueNotificationConfig?.length) {
          msg += `I will ${also}send notifications to this space about new issues. ` +
          `My current configuration is as follows: \n`;
          config.newIssueNotificationConfig.forEach(config => {
            `* Issue Types: Bug\n` +
            `* Components: ${config.components.join(',')}\n` +
            `* Team/PT(s): ${config.teamPts.join(', ')}\n\n`;
          });
        }
        await bot.say(msg);
      }
      if (show_instructions) {
        await bot.say(`I don't currently support any commands in group spaces, ` +
        `but I need to fix this....`);
      }
    } catch(e) {
      this.logger.error(`postGroupSpaceInstructions failed to post instructions to ${bot.room.title}`);
      this.logger.error(e.message);
      bot.say("Hmmn. I seem to have a database problem, and can't report my notification status.   Please ask again later.");
    }
  }

  /**
   * Evaluate and potentially notify group spaces about this event
   * 
   * @param {object} msgElement - the data needed to create a notification for this jira event
   * @param {function} createMessageFn -- function to create a jira event notification message
   * @param {function} cb - the (optional) callback function used by the test framework
   */
  evaluateForGroupSpaceNotification(msgElements, createMessageFn, cb) {
    if (this.boardTransitions) {
      this.boardTransitions.evaluateForTransitionNotification(msgElements,
        this.sendNotification, cb);
      // TODO -- Add new issues to watched filter caches
    }
    if (this.newIssueNotifications) {
      this.newIssueNotifications.evaluateForNewIssueNotifications(msgElements, 
        createMessageFn, this.sendNotification, cb);
    }
  }

  /**
   * Process a button press
   * 
   * @param {object} bot - bot instance in the feedback space
   * @param {object} trigger - frameworks trigger object
   */
  async processAttachmentAction(bot, trigger) {
    let attachmentAction = null;
    try {
      attachmentAction = trigger.attachmentAction;
      logger.verbose(`Got an attachmentAction:\n${JSON.stringify(attachmentAction, null, 2)}`);
      // Only process input from most recently displayed card
      let activeCardMessageId = await bot.recall('activeCardMessageId');
      if (attachmentAction.messageId !== activeCardMessageId) {
        return bot.reply(attachmentAction, 'I do not process button clicks from old cards.' +
          ' Scroll down to the most recent card, or mention me with the word "status" to get a new card.');
      }

      let inputs = attachmentAction.inputs;
      if (inputs.requestedTask === "updateBoardConfig") {
        return this.boardTransitions.updateBoardConfig(bot, trigger);
      } else if (inputs.feedback) {
          // process a feedback request
          return bot.reply(attachmentAction, 'Haven\'t implemented feedback yet!  Whoops!');
      } 
    } catch (e) {
      logger.error(`Error processing AttachmentAction in space "${bot.room.title}": ${e.message}`);
      if (typeof trigger === 'object') {
        this.logger.error(`trigger: ${JSON.stringify(trigger, null, 2)}`)
      } else {
        this.logger.error(`Invalid trigger object`);
      }
      return bot.reply(attachmentAction, 
        `Had a problem processing that request.  Error has been logged.`);
    }
  }

  /**
   * Send a notification to a group space
   * 
   * @param {object} bot - bot instance that will post the message
   * @param {object} msgElements - elements that make up the message
   * @param {string} message - the notification to send
   * @param {function} callback - callback (used by testing framework)
   */
  sendNotification(bot, msgElements, message, callback) {
    // Store the key of the last notification in case the user wants to reply
    let lastNotifiedIssue = {
      storyUrl: msgElements.issueSelf,
      storyKey: msgElements.issueKey
    };
    bot.store('lastNotifiedIssue', lastNotifiedIssue)
      .catch((e) => {
        this.logger.error(`groupNotifier:sendNotification(): ` +
          `Unable to store the messageId of the last notifiation sent to space` +
          `${bot.room.title}: ${e.message}`);
      });
    let sayPromise = bot.say({markdown: message});
    if (callback) {callback(null, bot);}
    return sayPromise;
  }



  
}

module.exports = GroupNotifications;
