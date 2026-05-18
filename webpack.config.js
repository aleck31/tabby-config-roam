const path = require('path')
const webpack = require('webpack')
const pkg = require('./package.json')

module.exports = {
  target: 'node',
  entry: './src/index.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'index.js',
    libraryTarget: 'commonjs2',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      PLUGIN_VERSION: JSON.stringify(pkg.version),
    }),
  ],
  externals: [
    /^@angular/,
    /^tabby-/,
    /^rxjs/,
  ],
}
