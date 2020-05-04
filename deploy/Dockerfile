FROM node:10

# Expect the build command to set BUILD_TIMESTAMP
ARG BUILD_TIMESTAMP
# Make it available to the running image
ENV DOCKER_BUILD=$BUILD_TIMESTAMP

# Setup the directories for our app and make them 
# accesible to non-root users.
RUN mkdir -p /usr/src/app
RUN chmod 755 /usr/src/app
RUN chmod g+s /usr/src/app
RUN mkdir -p /usr/src/app/JiraEvents
RUN mkdir -p /usr/src/app/potential-jira-event-test-cases
RUN chmod g+w /usr/src/app/JiraEvents
RUN chmod o+w /usr/src/app/potential-jira-event-test-cases
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./


RUN npm install
# If you are building your code for production
# RUN npm ci --only=production

# Bundle app source
COPY . .
# Allow app to discover version number in package.json
RUN chmod g+r ./package.json

EXPOSE 7000
CMD [ "node", "server.js" ]
