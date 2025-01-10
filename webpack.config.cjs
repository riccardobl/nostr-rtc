/* eslint-disable */
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { DefinePlugin } = require('webpack');
const dotenv = require('dotenv');
const dotenvExpand = require('dotenv-expand');

module.exports = (env, argv) => {
    const isDevelopment = argv.mode === 'development';
    if (isDevelopment) {
        const myEnv = dotenv.config();
        dotenvExpand.expand(myEnv);
    }

    const entryPoint = env.entry || './src/demo/index.ts';
    const outputDir = env.outputDir || 'dist';

    return {
        mode: isDevelopment ? 'development' : 'production',
        entry: entryPoint,
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    use: 'ts-loader',
                    exclude: /node_modules/,
                },
            ],
        },
        resolve: {
            extensions: ['.tsx', '.ts', '.js'],
        },
        output: {
            filename: env.library ? 'nostr-rtc.js' : 'bundle.js',
            path: path.resolve(__dirname, outputDir),
            library: env.library ? 'NostrRTC' : undefined,
            libraryTarget: env.library ? 'umd' : undefined,
        },
        devtool: 'source-map',
        devServer: {
            static: {
                directory: path.join(__dirname, outputDir),
            },
            compress: true,
            port: 9000,
            open: true,
        },
        plugins: [
            ...(env.library ? [] : [
            new HtmlWebpackPlugin({
                template: env.entry.replace(".ts", ".html"),
                filename: 'index.html'
            })]),


            new DefinePlugin({
                'process.env.NODE_ENV': JSON.stringify(isDevelopment ? 'development' : 'production'),
                'process.env.LOG_LEVEL': JSON.stringify(isDevelopment ? (process.env.LOG_LEVEL || 'TRACE') : 'INFO'),
                'process.env.LOGPIPE_ENDPOINT': JSON.stringify(isDevelopment ? (process.env.LOGPIPE_ENDPOINT || 'http://127.0.0.1:7068') : ""),
                'process.env.LOGPIPE_AUTHKEY': JSON.stringify(isDevelopment ? process.env.LOGPIPE_AUTHKEY : "")
            })
        ],
    };
};