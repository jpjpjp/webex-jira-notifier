// test-bot.js

let botIdCounter = 1;
let roomIdCounter = 1;
let TEST_MESSAGE_ID_FOR_MESSAGE = 'Fake Message Id for a message';
let TEST_MESSAGE_ID_FOR_CARD = 'Fake Message Id for a card';


// Create our own verion of the Framework's Bot object that supports our test cases.
class Bot {

  // Group space constructor
  constructor(titleOrUser, verbose, isDirect=false, config=null){
    if (isDirect) {
      this.isDirect = true;
      this.isDirectTo = titleOrUser;
      this.config = config;
    } else {
      this.isDirect = false;
      this.config =  {
        boards: [],
        newIssueNotificationConfig: []
      };
    }
    this.id = `BOT_ID_${botIdCounter++}`;
    this.room = {
      id: `ROOM_ID_${roomIdCounter++}`,
      title: titleOrUser
    };
    this.jiraEventMessage = '';
    this.verbose = verbose;
  }

  // Accesors for our fake IDs
  getFakeMessageId(){
    return TEST_MESSAGE_ID_FOR_MESSAGE;  
  }

  getFakeCardId() {
    return TEST_MESSAGE_ID_FOR_CARD;
  }

  // Handle any requests for bots to message rooms by logging to console
  // // jiraEventHandler will call bot.say to send a result to a Spark user
  say() {
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
  }


  // For test cases just treat replies as a regular message from the
  reply(parentId, msg) {
    return this.say(msg);
  }

  // For test cases just log card data in verbose mode
  sendCard(card) {
    if (this.verbose) {
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
  }

  // For test cases emulate storage of bot's config 
  store(storageId, config) {
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
  }

  // For test cases lets always find an actviteCardMessageId
  recall(key) {
    if (key === "activeCardMessageId") {
      if (this.activeCardMessageId) {
        return Promise.resolve(this.activeCardMessageId);
      } else {
        return Promise.resolve(TEST_MESSAGE_ID_FOR_CARD);
      }
    } else if (key === "groupSpaceConfig") {
      return Promise.resolve(this.config);
    } else if (key === 'userConfig') {
      return Promise.resolve(this.config);
    } else {
      return Promise.reject(new Error(`bot.recall: Unexpected key: ${key}`));
    }  
  }

}

module.exports = Bot;