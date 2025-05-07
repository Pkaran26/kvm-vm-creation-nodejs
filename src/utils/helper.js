const { exec } = require("child_process");
const fs = require('fs');

const executeCommand = (command, timeout = undefined) => {
  return new Promise((resolve, reject) => {
    exec(command, { timeout }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing command: ${command}`);
        console.error(stderr);
        reject(stderr);
        return;
      }
      resolve(stdout.trim());
    });
  });
};

const writeFile = (path, content) => {
  return new Promise((resolve, reject)=>{
    fs.writeFile(path, content, (err)=>{
      if (err) return reject(false);
      resolve(true);
    })
  })
}

const parseCMDResponse = (text) => {
  const lines = text.trim().split('\n');
  const header = lines[0].split(/\s{2,}/).map(s => s.trim()); // Split by 2+ spaces and trim
  const dataLines = lines.slice(2); // Skip header and separator

  return dataLines.map(line => {
    const values = line.split(/\s{2,}/).map(v => v.trim()); // Split by 2+ spaces and trim
    const obj = {};
    header.forEach((key, index) => {
      obj[key] = values[index];
    });
    return obj;
  });
}

module.exports = {
  executeCommand,
  writeFile,
  parseCMDResponse
}