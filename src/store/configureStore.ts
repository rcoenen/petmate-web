import { createStore, applyMiddleware, compose, Reducer } from 'redux';
import thunk from 'redux-thunk';
import { createLogger } from 'redux-logger';
import rootReducer from '../reducers';
import { RootState } from '../redux/types';

const configureStore = (initialState?: any) => {
  const middleware: any[] = [thunk];

  if (import.meta.env.DEV) {
    middleware.push(createLogger({ level: 'info', collapsed: true }));
  }

  const composeEnhancers =
    (window as any).__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ ?? compose;
  const enhancer = composeEnhancers(applyMiddleware(...middleware));

  return createStore(
    rootReducer as Reducer<RootState, any>,
    initialState,
    enhancer
  );
};

export default configureStore;
