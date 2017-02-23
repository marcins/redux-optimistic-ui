import i from 'icepick';

export const BEGIN = '@@optimist/BEGIN';
export const COMMIT = '@@optimist/COMMIT';
export const REVERT = '@@optimist/REVERT';

export const ensureState = state => {
  if (state instanceof Object && Array.isArray(state.history)) {
    return state.current;
  }
  return state;
};

export const preloadState = state => i.freeze({
  beforeState: undefined,
  history: [],
  current: state
});

const applyCommit = (state, commitId, reducer) => {
  const history = state.history;
  // If the action to commit is the first in the queue (most common scenario)
  if (history.length > 0 && history[0].meta.optimistic.id === commitId) {
    const historyWithoutCommit = i.shift(history);
    const nextOptimisticIndex = historyWithoutCommit.findIndex(action => action.meta && action.meta.optimistic && !action.meta.optimistic.isNotOptimistic && action.meta.optimistic.id);
    // If this is the only optimistic item in the queue, we're done!
    if (nextOptimisticIndex === -1) {
      return i.chain(state)
          .set('history', [])
          .set('beforeState', undefined)
          .value();
    }
    // Create a new history starting with the next one
    const newHistory = i.slice(historyWithoutCommit, nextOptimisticIndex);
    // And run every action up until that next one to get the new beforeState
    const newBeforeStateChain = i.chain(history);
    const newBeforeState = history.reduce((mutState, action, index) => {
      return index <= nextOptimisticIndex ? reducer(mutState, action) : mutState;
    }, state.beforeState);
    return i.chain(state)
        .set('history', newHistory)
        .set('beforeState', newBeforeState)
        .value();
  } else {
    // If the committed action isn't the first in the queue, find out where it is
    const actionIndex = history.findIndex(action => action.meta && action.meta.optimistic && action.meta.optimistic.id === commitId);
    const actionToCommit = history[actionIndex];
    if (!actionToCommit) {
      console.error(`@@optimist: Failed commit. Transaction #${commitId} does not exist!`);
    }
    // Make it a regular non-optimistic action
    const newAction = Object.assign({}, actionToCommit, {
      meta: Object.assign({}, actionToCommit.meta,
        {optimistic: null})
    });
    return i.set(state, 'history', i.splice(state.history, actionIndex, 1, newAction));
  }
};

const applyRevert = (state, revertId, reducer) => {
  const history = state.history;
  const beforeState = state.beforeState;
  let newHistory;
  // If the action to revert is the first in the queue (most common scenario)
  if (history.length > 0 && history[0].meta.optimistic.id === revertId) {
    const historyWithoutRevert = i.shift(history);
    const nextOptimisticIndex = historyWithoutRevert.findIndex(action => action.meta && action.meta.optimistic && !action.meta.optimistic.isNotOptimistic && action.meta.optimistic.id);
    // If this is the only optimistic action in the queue, we're done!
    if (nextOptimisticIndex === -1) {
      return i.chain(state)
          .set('history', [])
          .set('current', historyWithoutRevert.reduce((mutState, action) => reducer(mutState, action), beforeState))
          .set('beforeState', undefined)
          .value();
    }
    newHistory = i.slice(historyWithoutRevert, nextOptimisticIndex);
  } else {
    const indexToRevert = history.findIndex(action => action.meta && action.meta.optimistic && action.meta.optimistic.id === revertId);
    if (indexToRevert === -1) {
      console.error(`@@optimist: Failed revert. Transaction #${revertId} does not exist!`);
    }
    newHistory = i.splice(history, indexToRevert, 1);
  }
  const newCurrent = newHistory.reduce((mutState, action) => {
    return reducer(mutState, action)
  }, beforeState);
  return i.chain(state)
      .set('history', newHistory)
      .set('current', newCurrent)
      .set('beforeState', beforeState)
      .value();
};

export const optimistic = (reducer, rawConfig = {}) => {
  const config = Object.assign({
    maxHistory: 100
  }, rawConfig);
  let isReady = false;

  return (state, action) => {
    if (!isReady || state === undefined) {
      isReady = true
      state = preloadState(reducer(ensureState(state), {}));
    }
    const historySize = state.history.length;
    const {type, id} = (action.meta && action.meta.optimistic) || {};

    // a historySize means there is at least 1 outstanding fetch
    if (historySize) {
      if (type !== COMMIT && type !== REVERT) {
        if (historySize > config.maxHistory) {
          console.error(`@@optimist: Possible memory leak detected.
                  Verify all actions result in a commit or revert and
                  don't use optimistic-UI for long-running server fetches`);
        }
        // if it's a BEGIN but we already have a historySize, treat it like a non-opt
        return i.chain(state)
            .set('history', i.push(state.history, action))
            .set('current', reducer(state.current, action))
            .value();
      }
      // for resolutions, add a flag so that we know it is not an optimistic action
      i.thaw(action).meta.optimistic.isNotOptimistic = true;

      // include the resolution in the history & current state
      const nextState = i.chain(state)
          .set('history', i.push(state.history, action))
          .set('current', reducer(state.current, action))
          .value();

      const applyFunc = type === COMMIT ? applyCommit : applyRevert;
      return applyFunc(nextState, id, reducer);
    }
    // create a beforeState since one doesn't already exist
    if (type === BEGIN) {
      return i.chain(state)
          .set('history', i.push(state.history, action))
          .set('current', reducer(state.current, action))
          .set('beforeState', state.current)
          .value();
    }

    // standard action escape
    return i.set(state, 'current', reducer(state.current, action));
  };
};
