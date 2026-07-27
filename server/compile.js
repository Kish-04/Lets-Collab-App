const path = require('path');
const fs = require('fs');
const solc = require('solc');

const contractPath = path.resolve(__dirname, 'contracts', 'IRCPTracker.sol');
const source = fs.readFileSync(contractPath, 'utf8');

const input = {
  language: 'Solidity',
  sources: {
    'IRCPTracker.sol': {
      content: source,
    },
  },
  settings: {
    outputSelection: {
      '*': {
        '*': ['*'],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

if (output.errors) {
  output.errors.forEach((err) => console.error(err.formattedMessage));
  if (output.errors.some((err) => err.severity === 'error')) {
    process.exit(1);
  }
}

const contract = output.contracts['IRCPTracker.sol']['IRCPTracker'];

fs.writeFileSync(
  path.resolve(__dirname, 'contracts', 'IRCPTracker.json'),
  JSON.stringify(contract, null, 2)
);

console.log('Contract Compiled Successfully!');
