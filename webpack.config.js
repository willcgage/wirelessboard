const path = require('path');
const webpack = require('webpack');


module.exports = {
  devtool: 'source-map',
  resolve: {
    extensions: ['.mjs', '.js', '.jsx', '.json'],
  },
  // entry: ['./js/script.js','./js/gif.js','./js/chart-smoothie.js','./js/demodata.js'],
  entry: {
    app: ['whatwg-fetch', './js/app.js'],
    venue: ['./js/venues.js'],
    web: ['./js/web.js'],
    about: ['./js/about.js'],
  },
  output: {
    path: path.resolve(__dirname, 'static'),
    filename: '[name].js',
  },
  plugins: [
    new webpack.DefinePlugin({
      VERSION: JSON.stringify(require("./package.json").version)
    }),
  ],
  module: {
    rules: [
      {
        test: /\.mjs$/,
        include: /node_modules\/@shopify\/draggable/,
        type: 'javascript/auto',
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env'],
          },
        },
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.s[ac]ss$/i,
        use: [
          'style-loader',
          'css-loader',
          {
            loader: 'sass-loader',
            options: { implementation: require('sass') },
          },
        ],
      },
      {
        test: /\.(woff2?|ttf|eot|otf|svg)$/i,
        type: 'asset/resource',
        generator: {
          filename: 'fonts/[name][ext]'
        }
      },
    ],
  },
};
