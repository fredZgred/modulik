const { resolve } = require('path');
const express = require('express');
const webpack = require('webpack');
const webpackDevMiddleware = require('webpack-dev-middleware');
const modulik = require('../../');
const webpackConfig = require('../webpack.config');

const ssrModulik = modulik('./ssr', {
  watch: ['./App'],
  extensions: ['jsx'],
  disabled: process.env.NODE_ENV === 'production',
});

const port = process.argv[2];

const app = express();
const compiler = webpack(webpackConfig);

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(resolve(__dirname, 'static')));
} else {
  app.use(webpackDevMiddleware(compiler, { stats: 'minimal' }));
}
app.use(/^\/(index.html)?$/, async (req, res) => {
  const ssr = await ssrModulik.module;
  const response = await ssr({ title: 'Hello World' });
  res.send(response);
});

app.listen(port, () => console.info(`Listening on port ${port}`));
