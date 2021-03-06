module.exports = {
    'extends': ['standard'],
    'env': {
        'browser': false,
        'es6': true,
        'jest': true,
    },
    'parserOptions': {
        'ecmaVersion': 8,
        'sourceType': 'script',
    },
    'ignorePatterns': ['.eslintrc.js'],
    'rules': {
        'indent': ['error', 4, {'SwitchCase': 1}],
        'space-before-function-paren': ['error', {
            'anonymous': 'never',
            'named': 'never',
            'asyncArrow': 'always',
        }],
        'keyword-spacing': 'off',
        'brace-style': ['error', 'stroustrup', {'allowSingleLine': true}],
        'quotes': ['error', 'single', {'avoidEscape': true}],
        'comma-dangle': ['error', 'always-multiline'],
        'operator-linebreak': ['error', 'before'],
    },
}
