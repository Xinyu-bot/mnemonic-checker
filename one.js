const { Worker, isMainThread } = require('worker_threads');
const { program } = require('commander');
const fs = require('fs');
const ethers = require('ethers');
const async = require('async');
const bip39 = require('bip39');

// Constants
const N = 12; // Number of worker threads
const ADDRESS_BATCH_SIZE = 100;
const CHECK_INTERVAL = 2000; // 2 seconds
const REQUEST_DELAY = 200; // Delay between balance check requests in milliseconds

// Address Queue
const addressQueue = async.queue(async (task, done) => {
    try {
        const balance = await provider.getBalance(task.address);
        if (balance.gt(0)) {
            fs.appendFileSync('results.txt', `${task.address},${task.privateKey},${balance.toString()}\n`);
        }
    } catch (error) {
        console.error(`Error checking balance for ${task.address}: ${error.message}`);
    } finally {
        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY)); // Add delay to throttle requests
        progress.totalProcessed++;
        done();
    }
}, N); // Concurrency level

// Progress counter
let progress = {
    totalGenerated: 0,
    totalProcessed: 0,
    startTime: Date.now()
};

// Program options
program.option("-c, --count <number>", "number of processes");
const options = program.parse().opts();
const count = parseInt(options.count) || N;

console.log(`Starting ${count} processes`.yellow);

// WebSocket Provider
const provider = new ethers.providers.WebSocketProvider('wss://eth-mainnet.g.alchemy.com/v2/');

// Function to generate a random 12-word mnemonic
function gen12() {
    return bip39.generateMnemonic(128); // 128 bits for 12 words mnemonic
}

// Address generator function
async function generateAddresses() {
    while (true) {
        if (addressQueue.length() < count * ADDRESS_BATCH_SIZE) {
            for (let i = 0; i < ADDRESS_BATCH_SIZE; i++) {
                const mnemonic = gen12();
                const wallet = ethers.Wallet.fromMnemonic(mnemonic);
                addressQueue.push({ address: wallet.address, privateKey: wallet.privateKey });
                progress.totalGenerated++;
            }
        }
        await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL)); // Check every few seconds
    }
}

// Worker function to check balance
async function checkBalance() {
    while (true) {
        await new Promise(resolve => setTimeout(resolve, 100)); // Wait a bit if the queue is empty
    }
}

// Function to format the elapsed time
function formatElapsedTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

// Function to log progress
function logProgress() {
    let lastProcessedCount = 0;
    setInterval(() => {
        const now = Date.now();
        const elapsedTime = now - progress.startTime;
        const elapsedFormatted = formatElapsedTime(elapsedTime);
        const totalChecked = progress.totalProcessed;
        const speed = (totalChecked - lastProcessedCount) / (CHECK_INTERVAL / 1000);
        lastProcessedCount = totalChecked;
        console.log(`Checked: ${totalChecked} (${elapsedFormatted}, ${speed.toFixed(2)} addr/s)`);
    }, CHECK_INTERVAL);
}

// Main function to start everything
(async () => {
    if (isMainThread) {
        // Start address generator
        generateAddresses();

        // Start worker threads
        for (let i = 0; i < count; i++) {
            const worker = new Worker(__filename);
            worker.on('error', (err) => console.error(err));
            worker.on('exit', (code) => {
                if (code !== 0) console.error(`Worker stopped with exit code ${code}`);
            });
        }

        // Start logging progress
        logProgress();
    } else {
        // Worker thread
        checkBalance();
    }
})();
