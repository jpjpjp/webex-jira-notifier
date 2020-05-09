/*
 * build-yaml-from-json.js
 *
 * This file will build a kubernetes openshift yaml file
 * that instructs openshift to pull and run the latests
 * version of our app.
 * 
 * It is hard coded to read in two "seed" configuration files
 * 
 * service-seed.json is the templatized configuration for
 * the router service that maps requests to the appropriate 
 * port in our docker image.
 * 
 * deploy-seed.json is the templatized configuration for the
 * image that will run in the pod itself
 * 
 * This file builds a "view", using variables defined in a .env
 * file in this directory (and with the package.json version)
 * After the seed json files are read in, 
 * they are converted to a string and the view is applied to "template"
 * Once the templates are replaced with the actual values the string
 * is converted back to a json, which is converted to a yaml string.
 * 
 * Finally the info is written to a deploy-new-image.yaml file 
 */
const fs = require('fs');
const yaml = require('js-yaml');
const Mustache = require('mustache');
require('dotenv').config();

const package_version = require('../package.json').version;

try {
  const view = {
    projectName: process.env.PROJECT_NAME,
    serviceName: process.env.SERVICE_NAME,
    incomingPort: process.env.INCOMING_PORT,
    targetPort: process.env.TARGET_PORT,
    appName: process.env.APP_NAME,
    configName: process.env.CONFIG_NAME,
    containerHub: process.env.CONTAINER_HUB,
    userName: process.env.USER_NAME,
    imageVersion: package_version,
    pullSecret: process.env.PULL_SECRET
  };
  let serviceYaml = loadTemplate('./input/service-seed.json', view);
  let yamlStr = yaml.dump(serviceYaml);
  yamlStr += '---\n';
  let deployYaml = loadTemplate('./input/deploy-seed.json', view);
  yamlStr += yaml.dump(deployYaml);
  
  return fs.writeFile(`./output/deploy-new-image-${package_version}.yaml`, yamlStr, 'utf8', (err) => {
    if (err) {throw err;}
    console.log(`New deploy-new-image.yaml ready.`);
    return;
  });
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
  if (expanded.spec.template && expanded.spec.template.spec.containers[0].image) {
    console.log(expanded.spec.template.spec.containers[0].image);
  }
  return(expanded);

}