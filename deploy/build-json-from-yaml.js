/*
 * build-json-from-yaml.js
 *
 * Our build yaml premise is based on the idea that 
 * we have "seed" json files.  This file can be 
 * used to generate new seeds from an existing working
 * yaml configuration.  It will read in the yaml file
 * and then dump out a JSON for each document that it finds.
 * 
 * A typical next step would be to take the output JSON which
 * will be written with a name "service.json", where service
 * will be the "kind" field from the yaml document.
 * 
 * A typical next step once the JSON is extracted from the yaml
 * is to "templatize" that JSON and save it as a "seed" file.
 * Each value that is a secret (or might change from deploy to deploy),
 * should be removed and replaced with mustache template, ie: "{{name}}"
 * 
 * Once the seeds are properly templatized, build-yaml-from-json.js
 * can be run to generate a deploy-new-image.yaml file based
 * on the templatized seeds and the enviornment that defines
 * the template values.
 * 
 * CAUTION--Don't overwrite the existing seeds!
 */

const fs = require('fs');
const yaml = require('js-yaml');

try {
  let fileContents = fs.readFileSync('./cisco-jira-notifier.yaml', 'utf8');
  let data = yaml.safeLoadAll(fileContents);
  data.forEach((doc) => {
    console.log(`Will write ${doc.kind}.json`);
    fs.writeFile(`${doc.kind}.json`, JSON.stringify(doc, 2, 2));
  });

} catch (e) {
  console.log(e);
}