// build-yaml.js
const fs = require('fs');
const yaml = require('js-yaml');
const Mustache = require('mustache');
require('dotenv').config();

const package_version = require('../package.json').version;

try {
  let configs = [];
  const view = {
    serviceName: process.env.SERVICE_NAME,
    podName: process.env.POD_NAME,
    incomingPort: process.env.INCOMING_PORT,
    targetPort: process.env.TARGET_PORT,
    appName: process.env.APP_NAME,
    configName: process.env.CONFIG_NAME,
    containerHub: process.env.CONTAINER_HUB,
    userName: process.env.USER_NAME,
    imageVersion: package_version,
    pullSecret: process.env.PULL_SECRET
  };
  configs.push(loadTemplate('./service-seed.json', view));
  configs.push(loadTemplate('./deploy-seed.json', view));
  let yamlStr = yaml.dump(configs);
  fs.writeFileSync('data-out.yaml', yamlStr, 'utf8');

  // let fileContents = await fs.readFile('./cisco-jira-notifier.yaml', 'utf8');
  // let data = yaml.safeLoadAll(fileContents);
  // data.forEach((doc) => {
  //     console.log(`Will write ${doc.kind}.json`)
  //     fs.writeFile(`${doc.kind}.json`, JSON.stringify(doc, 2, 2));
  // });

  //console.log(configs);
} catch (e) {
  console.log(e);
}

function loadTemplate(filename, view) {
  let templateJson = require(filename);
  let expanded = JSON.parse(Mustache.render(
    JSON.stringify(templateJson), 
    view));
  // Convert templatized values that should be ints
  if (expanded.spec.ports && expanded.spec.ports[0].port) {
    expanded.spec.ports[0].port = parseInt(expanded.spec.ports[0].port);
  }
  if (expanded.spec.ports && expanded.spec.ports[0].targetPort) {
    expanded.spec.ports[0].targetPort = parseInt(expanded.spec.ports[0].targetPort);
  }
  if (expanded.spec.template && expanded.spec.template.spec.containers[0].ports[0].containerPort) {
    expanded.spec.template.spec.containers[0].ports[0].containerPort =
         parseInt(expanded.spec.template.spec.containers[0].ports[0].containerPort);
  }
  return(expanded);

}