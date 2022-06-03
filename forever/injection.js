const ExecQueue = require('./execqueue');
const child_process = require('child_process');
const fs = require('fs');

class InjectManager {
    constructor() {
        this.injectQueue = new ExecQueue(5000);
    }

    injectInternal(pid, callback) {
        console.log(`[INJ] Injecting into ${pid}`);
        const cp = child_process.spawn('bash', ['inject.sh', `${parseInt(pid)}`], {uid: 0, gid: 0});
        const to = setTimeout(function () {
            console.log(`[INJ] Injecting into ${pid} timed out`);
            cp.removeAllListeners('exit');
            cp.kill('SIGKILL');
            callback(new Error('timed out'));
        }, 7500);
        cp.on('exit', function (code, signal) {
            clearTimeout(to);
            if (callback) {
                if (code !== null) {
                    callback(null);
                } else {
                    callback(new Error('signal ' + signal));
                }
            }
        });
    }

    inject(pid, callback) {
        this.injectQueue.push(this.injectInternal.bind(this, pid, callback));
    }

    injected(pid) {
        const maps = fs.readFileSync(`/proc/${pid}/maps`).toString();
        return (maps.indexOf('cathook') > 0);
    }
}

module.exports = new InjectManager();
