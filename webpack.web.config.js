const CopyWebpackPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const path = require('path');

module.exports = [
  {
    entry: './src/renderer/index.ts',
    devtool: "source-map",
    target: 'web',
    module: {
      rules: [
        {
          test: /\.ts?$/,
          use: 'ts-loader',
          exclude: [/node_modules/, /src\/testcode/],
        },
        {
          test: /\.css$/i,
          use: ["style-loader", "css-loader"],
        },
      ],
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.js'],
      alias: {
      },
      fallback: {
        'fs': false,
        'vm': false,
        'perf_hooks': false,
      },
    },
    stats: {
      warningsFilter: [
        /Critical dependency/,  // from typescript.js
      ],
    },
    externals: {
      'node:fs': 'commonjs2 node:fs'
    },
    output: {
      filename: 'bundle.js',
      path: path.resolve(__dirname, 'dist'),
      library: 'NanoApp',
      globalObject: 'self',
    },

    plugins: [
      new HtmlWebpackPlugin({
          title: '',
          template: 'src/renderer/index.html' }),
      new CopyWebpackPlugin({
          patterns: [
              { from: 'libcode/**', filter: (filepath) => !filepath.includes('tsconfig.json') },
          ],
      }),
    ],

    devServer: {
      static: path.join(__dirname, "dist"),
      compress: true,
      port: 4000,
      watchFiles: ["libcode/*"],
      hot: true,
    },

    performance: {
      maxAssetSize: 1048576,
      maxEntrypointSize: 1048576,
    },
  }
];
