import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

const baseConfig = await generateEslintConfig({
	enableTypescript: true,
})

export default [
	{
		ignores: ['dist/**', 'dist-test/**', 'pkg/**'],
	},
	...baseConfig,
	{
		// node:test's describe/it return promises that are not meant to be awaited.
		files: ['src/**/*.spec.ts', 'src/**/__tests__/**/*.ts'],
		rules: {
			'@typescript-eslint/no-floating-promises': 'off',
		},
	},
]
