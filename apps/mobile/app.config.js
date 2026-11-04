module.exports = ({config}) => process.env.TIEZ_PLUS_TEST_BUILD === '1' ? {
  ...config, name: 'TIEZ Plus 测试版', scheme: 'tiezplustest',
  android: {...config.android, package: 'io.github.learner20230724.tiezplus.test'},
} : config;
