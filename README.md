# cisco-jira-notifier
Bot to notify users of the Cisco jira system when a ticket has been assigned to them or they have been mentioned.

This bot works only in one on one rooms, not in spaces.   Because its impossible to "leave" a one on one room, the bot supports "shut up", and "come back" commands to turn off notifications.   It also supports a "status" command to check if notifications are on or off.

Each user's status is stored in a Mongo Atlas database.   This could be optionally removed or replaced with another filestore.

The first time a user creates a room with the bot a help message is presented.   After that is accesible via the command "help".

The bot also notifies the author/admin whose email is specified in the ADMIN_EMAIL environment variable about usage.  There is also an undocumented bot command /showadmintheusers which will send a list of all people using the bot in the space with the Admin user.

## Checklist (absolute bare minimum to get a jira-notifier bot working)

Prerequisites:

- [ ] node.js (minimum supported v4.2.6 with *use-strict* runtime flag & npm 2.14.12 and up)

- [ ] Sign up for Cisco Spark (logged in with your web browser)

- [ ] Administrator of Jira system that you'd like to notify for.   

- [ ] A Mongo Atlas account.

----

- [ ] Sign up for nGrok (save API key) and start it on your machine (save the port number and public web address): https://ngrok.com/download

- [ ] As a Jira administrator configure Jira to set up a webhook that will fire whenever an Issue is created, updated or deleted.  The url will be the URL where your ngrok server is running (during development), or the url where your app ins running in production, with appended with '/jira'.  For example: http://myserver.ngrok.io/jira

- [ ] Create a Cisco Spark Bot (save the email address and API key): https://developer.ciscospark.com/add-bot.html

- [ ] Create or use an existing Mongo Altas DB account and create a Database to save each users setting information in.

## Starting the server

Set the following environmnt varibles in a file if running locally or in your production environment
* WEBHOOK - the url where the application is running WITHOUT the '/jira' on the end.  For example: http://myserver.ngrok.io
* TOKEN - the token that you got when you created your bot at https://developer.ciscospark.com/add-bot.html
* PORT - the port where your app is running.  This is typically needed when running locally with ngrok, and set automatically when running in a production environemnt.
* EMAIL_ORG - the email domain that all your Jira users belong to, ie: "my-company.com"
* MONGO_USER - the username to access your Mongo Atlas DB
* MONGO_PW - the password to access your Mongo Atlas DB
* MONGO_URL - the url where your Mongo Atlas DB is running
* MONGO_DB - the name of the Mongo Atlas DB to use
* ADMIN_EMAIL - the email address of the Cisco Spark user to notify about bot activity.  This is generally the developer who maintains this bot

Start your node server in your enviornment.  This can be done via a debugger when running locally or by entering the following:
    ```npm start```

## Using the bot

Once the server is up and running Cisco Spark users can get Jira Notifications by creating a one-on-on space with the bot.  You will need to inform your users of the email address that you specified when you created the bot at https://developer.ciscospark.com/add-bot.html

The bot only works in one on one spaces.  If a user attempts to add it to a group space it will immediately exit.

When a user succesfully creates a one-on-one space with the bot, they will get an inititial welcome message.  Subsequently the bot will send them messages when they are mentioned in a jira ticket, if a jira ticket is assigned to them, if a jira ticket they were assigned to is assigned to someone else, or if a jira ticket hey were assigned to is deleted.   A private message will be sent from the bot to the user specified via the ADMIN_EMAIL environemnt varialbe letting them know about the new user.

The following commands are supported:
* shut up - since you can never really "leave" a one on one space, this tells the user to stop notifying them.
* come back - tells the bot to start notifying the user again.
* status - tells the user if the bot is notifying them or not
* help - tells the user these commands


## Tests
The project comes with a set of reference Jira events.  When modifying the jira-notifer module developers can check to ensuer that nothing broke by running the following command:      ```npm test```

When the app encounters something unepexpected in the jira webhook payload which causes an exception, the offending payload is saved in the jira-event-test-cases directory.  Developerss can modify the test-jira-event-handler.js to send new payloads to the test framework and modify the app to support these payloads

## TO-DO
* The current implementation requires that all jira users belong to the same email domain.  A future enhancement might support multiple domains and add code to translate jira mentions to the right email org.
* The current implementation will let ANYONE create a space with our bot, but only users who's spark email address belongs to the specified email org will ever be notified.   A nice improvement might be for the bot to tell users this.
* Some users might like to be notified anytime an issue they are watching is updated.   Other users may not appreciate this noise.   A nice feature might be to add additional commands to turn full notifications for watchers on/off.  (And of course to implement the code to actually notify the watchers in the jira-notifer.js module)