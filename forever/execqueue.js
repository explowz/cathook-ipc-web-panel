class ExecQueue {
    constructor(rate) {
        this.rate = 0;
        this.queue = [];
        this.interval = setInterval(this.exec.bind(this), rate);
    }

    exec() {
        const a = (this.queue.shift());
        if (a) a();
    }

    push(callback) {
        this.queue.push(callback);
    }
}

module.exports = ExecQueue;