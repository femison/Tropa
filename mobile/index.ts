import { registerRootComponent } from 'expo';

import App from './App';
// Фоновая задача записи прогулки должна быть объявлена до запуска приложения
import './src/services/backgroundWalk';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
