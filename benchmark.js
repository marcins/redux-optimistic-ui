const fs = require('fs');
const profiler = require('v8-profiler');
const redux = require('redux');

const optimist = require('./lib/index');

const reducer = (state, action) => {
    if (action.type === 'INC') {
        return {
            counter: state.counter + 1
        };
    }
    return state;
}

const initialState = {
    counter: 0
};

const initialSnapshot = profiler.takeSnapshot();
const optimisticReducer = optimist.optimistic(reducer, { maxHistory: 1000000000 });

const store = redux.createStore(optimisticReducer, initialState);
const startTime = Date.now();
profiler.startProfiling('benchmark');

const actionCreator = (id, optimisticType) => {
    const action = {
        type: optimisticType && optimisticType !== optimist.BEGIN ? '--' : 'INC',
        data: new Buffer(1024).toString('utf-8')
    };
    if (optimisticType) {
        action.meta = {};
        action.meta.optimistic = {
            id,
            type: optimisticType
        }
    }
    return action;
}

for (let i = 0; i < 10000; i++) {
    let action;
    const select = i % 10;
    if (select < 3) {
        store.dispatch(actionCreator(i));
    } else if (select < 6) {
        store.dispatch(actionCreator(i, optimist.BEGIN));
        setTimeout(() => store.dispatch(actionCreator(i, optimist.COMMIT)), 10);
    } else if(select < 8) {
        store.dispatch(actionCreator(i, optimist.BEGIN));
        setTimeout(() => store.dispatch(actionCreator(i, optimist.COMMIT)), 1000);
    } else {
        store.dispatch(actionCreator(i, optimist.BEGIN));
        setTimeout(() => store.dispatch(actionCreator(i, optimist.REVERT)), 250);
    }
    if (i % 1000 === 0) {
        console.log("Running", i);
    }
}

setTimeout(() => {
    const endTime = Date.now();
    console.log("Elapsed time", endTime - startTime, "ms");
    console.log("Completing profiling...");
    const profile = profiler.stopProfiling('benchmark');
    const finalSnapshot = profiler.takeSnapshot();
    console.log("Writing profiles...");
    console.log(JSON.stringify(store.getState(), null, 2));
    finalSnapshot.export((err, result) => {
        fs.writeFileSync('benchmark.heapsnapshot', result);
    });
    profile.export((err, result) => {
        fs.writeFileSync('benchmark.cpuprofile', result);
    });
}, 2000);

console.log("Waiting a few seconds...");