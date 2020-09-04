// group-status.js

// When running locally read environment variables from a .env file
require('dotenv').config();

// The Adaptive Cards Template SDK helps us populate a card design
// template with values from a data source
var ACData = require("adaptivecards-templating");


/**
 * Module that manages the creation of a dynamic card
 * that allows users in group spaces with this bot to 
 * see and modify the configuration that controls what 
 * type of notifications are sent to the space
 *
 * @module GroupStatus
 */
class GroupStatus {
  /**
   * GroupStatus constructor
   */
  constructor() {
    // Read in the templates for the buttons
    this.statusCardTemplate = require('../card-design/group-config.json');
    if (process.env.JIRA_URL) {
      // Tie the status message to our jira instance
      this.statusCardTemplate.body[1].text += `the Jira instance running at the URL: ${process.env.JIRA_URL}`;
    } else {
      this.statusCardTemplate.body[1].text += 'your company\'s Jira instance.';
    }

    this.updatedCardTemplate = require('../card-design/updated-config.json');
    this.addBoardButton = require('../card-design/add-a-board.json');
    this.deleteBoardButtonTemplate = require('../card-design/delete-boards.json');
    if ((process.env.ASK_SPACE_NAME) && (process.env.ASK_SPACE_URL)) {
      let feedbackButton = require('../card-design/submit-feedback.json');
      let template = new ACData.Template(feedbackButton);
      this.feedbackButton = template.expand({
        $root: {
          askSpace: process.env.ASK_SPACE_NAME,
          askUrl: process.env.ASK_SPACE_URL
        }
      });
    } else {
      this.feedbackButton = null;
    }
    this.feedbackSpaceBot = null;
  }

  /**
   * getter for the group status feedback space
   * 
   * @returns {object} the bot instance in the feedback space
   */
  getFeedbackSpaceBot() {
    return this.feedbackSpaceBot;
  }

  /**
   * setter for the group status feedback space
   * 
   * @param {object} bot - bot instance in the feedback space
   */
  getFeedbackSpaceBot(bot) {
    return this.feedbackSpaceBot = bot;
  }

  /**
   * Build a status card based on the bot's current configuration
   * and post it to the bots space
   * 
   * @param {object} bot - bot instance in the feedback space
   * @param {object} readyConfig - config for space if available
   */
  async postStatusCard(bot, readyConfig=null) {
    let statusCard = JSON.parse(JSON.stringify(this.statusCardTemplate));
    return this.postConfigCard(bot, statusCard, readyConfig);
  }

  /**
   * Build a status card based on the bot's current configuration
   * and post it to the bots space
   * 
   * @param {object} bot - bot instance in the feedback space
   * @param {object} readyConfig - config for space if available
   */
  async postSuccessCard(bot) {
    let updatedCard = JSON.parse(JSON.stringify(this.updatedCardTemplate));
    return this.postConfigCard(bot, updatedCard);
  }
  

  /**
   * Build a status card based on the bot's current configuration
   * and post it to the bots space
   * 
   * @param {object} bot - bot instance in the feedback space
   * @param {object} card - card template to start with
   * @param {object} readyConfig - config for space if available
   */
  async postConfigCard(bot, card, readyConfig=null) {
    try {
      let config = (readyConfig) ? readyConfig : await bot.recall('groupSpaceConfig');
      let configList = '';
      let deleteChoices = {
        items: []
      };
      config.boards.forEach((board) =>{
        configList +=`* [${board.name}](${board.webUrl})\n`;
        // In the current template the Input.ChoiceSet is the 2nd element in the body array
        // deleteBoardButton.card.body[2].choices.push({
        //   title: `${board.id}: ${board.name}`,
        //   value: board.id
        // });
        deleteChoices.items.push({
          choice: `${board.type} ${board.id}: ${board.name}`,
          value: `${board.id}:${board.type}`
        });

      });
      // Fill in the last text field in the card template with 
      // the board list info for this bot's space
      let listField = card.body[card.body.length-1];
      if (!configList.length) {
        listField.text = 'There are no boards configured yet.';
        card.actions.push(this.addBoardButton);   
      } else {
        listField.text = 
          `I am watching for transitions on the following boards:\n\n${configList}`;
        if (config.boards.length < 3) {
          card.actions.push(this.addBoardButton);
        }

        // Expand the delete button template to include current boards
        let template = new ACData.Template(this.deleteBoardButtonTemplate);
        let deleteBoardButton = template.expand({
          $root: deleteChoices
        });
        
        card.actions.push(deleteBoardButton);
      }
      if ((this.feedbackButton) && (typeof this.feedbackSpaceBot === 'object')) {
        card.actions.push(this.feedbackButton); 
      }
    
      // Post the card
      return bot.sendCard(card)
        .then((message => bot.store('activeCardMessageId', message.id)));
    } catch (e) {
      return Promise.reject(e);
    }
  }

}

module.exports = GroupStatus;
