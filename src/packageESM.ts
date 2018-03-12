/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as ts from 'typescript';
import * as path from 'path';

export interface IOptions {
	repoRoot: string;
	esmSource: string;
	esmDestination: string;
	entryPoints: string[];
	resolveAlias: {
		[module: string]: string
	};
	resolveSkip: string[];
	destinationFolderSimplification: {
		[subpath: string]: string;
	};
}

export function _packageESM(options: IOptions): void {
	options.repoRoot = path.normalize(options.repoRoot).replace(/(\/|\\)$/, '');

	const ESM_SRC = path.join(options.repoRoot, options.esmSource);
	const ESM_DEST = path.join(options.repoRoot, options.esmDestination);

	let in_queue: { [filePath: string]: boolean; } = Object.create(null);
	let queue: string[] = [];

	const enqueue = (filePath: string) => {
		if (in_queue[filePath]) {
			return;
		}
		in_queue[filePath] = true;
		queue.push(filePath);
	};

	const seenDir: { [key: string]: boolean; } = {};
	const createDirectoryRecursive = (dir: string) => {
		if (seenDir[dir]) {
			return;
		}

		let lastSlash = dir.lastIndexOf('/');
		if (lastSlash === -1) {
			lastSlash = dir.lastIndexOf('\\');
		}
		if (lastSlash !== -1) {
			createDirectoryRecursive(dir.substring(0, lastSlash));
		}
		seenDir[dir] = true;
		try { fs.mkdirSync(dir); } catch (err) { }
	};

	seenDir[options.repoRoot] = true;

	const applyDestinationFolderSimplifications = (filePath: string) => {
		filePath = filePath.replace(/\\/g, '/');
		for (let key in options.destinationFolderSimplification) {
			const test = key.replace(/\\/g, '/');
			while (filePath.indexOf(test) >= 0) {
				filePath = filePath.replace(test, options.destinationFolderSimplification[test])
			}
		}
		return filePath;
	};

	const shouldSkipImport = (importText: string) => {
		for (let i = 0; i < options.resolveSkip.length; i++) {
			const skip = options.resolveSkip[i];
			if (importText.indexOf(skip) === 0) {
				return true;
			}
		}
		return false;
	}

	const computeDestinationFilePath = (filePath: string) => {
		if (filePath.indexOf(ESM_SRC) === 0) {
			// This file is from our sources
			return path.join(ESM_DEST, path.relative(ESM_SRC, filePath));
		} else {
			// This file is from node_modules
			return path.normalize(
				applyDestinationFolderSimplifications(
					path.join(ESM_DEST, path.relative(options.repoRoot, filePath))
				)
			);
		}
	}

	const write = (filePath: string, fileContents: string) => {
		const finalFilePath = computeDestinationFilePath(filePath);
		createDirectoryRecursive(path.dirname(finalFilePath));
		fs.writeFileSync(finalFilePath, fileContents);
	};

	options.entryPoints.forEach((filePath) => {
		enqueue(path.join(ESM_SRC, filePath));
	})

	while (queue.length > 0) {
		const filePath = queue.shift();

		let fileContents = fs.readFileSync(filePath).toString();
		const info = ts.preProcessFile(fileContents);

		for (let i = info.importedFiles.length - 1; i >= 0; i--) {
			const importText = info.importedFiles[i].fileName;

			if (shouldSkipImport(importText)) {
				continue;
			}

			const pos = info.importedFiles[i].pos;
			const end = info.importedFiles[i].end;

			if (/(^\.\/)|(^\.\.\/)/.test(importText)) {
				// Relative import

				const importedFilename = path.join(path.dirname(filePath), importText) + '.js';
				enqueue(importedFilename);

			} else {

				let importedFilename: string;
				if (options.resolveAlias[importText]) {
					importedFilename = options.resolveAlias[importText];
				} else {
					importedFilename = findNodeModuleImport(options.repoRoot, importText, filePath);
				}

				const myDestinationPath = computeDestinationFilePath(filePath);
				const importDestinationPath = computeDestinationFilePath(importedFilename);
				let relativePath = path.relative(path.dirname(myDestinationPath), importDestinationPath);
				if (!/(^\.\/)|(^\.\.\/)/.test(relativePath)) {
					relativePath = './' + relativePath;
				}

				relativePath = relativePath.replace(/\\/g, '/');
				relativePath = relativePath.replace(/\.js$/, '');

				fileContents = (
					fileContents.substring(0, pos + 1)
					+ relativePath
					+ fileContents.substring(end + 1)
				);

				enqueue(importedFilename);
			}
		}

		write(filePath, fileContents);
	}
}

function findNodeModuleImport(repoRoot: string, module: string, sourceFilePath: string): string {
	let modulePath = findNodeModule(repoRoot, module, sourceFilePath);

	let modulePackagePath = path.join(modulePath, 'package.json');
	if (!fs.existsSync(modulePackagePath)) {
		throw new Error(`Missing ${modulePackagePath} in node module ${modulePath}`);
	}

	let modulePackage = JSON.parse(fs.readFileSync(modulePackagePath).toString());
	if (typeof modulePackage.module !== 'string') {
		throw new Error(`Missing property 'module' package.json at ${modulePackagePath}`);
	}

	let result = path.join(modulePath, modulePackage.module);
	if (!fs.existsSync(result)) {
		throw new Error(`Missing file ${result}`);
	}
	return result;

	function findNodeModule(repoRoot: string, module: string, sourceFilePath: string): string {
		let modulePaths = generatePaths(repoRoot, module, sourceFilePath);
		for (let i = 0; i < modulePaths.length; i++) {
			if (fs.existsSync(modulePaths[i])) {
				return modulePaths[i];
			}
		}
		throw new Error(`Cannot find module ${module} requested by ${sourceFilePath}`);
	}

	function generatePaths(repoRoot: string, module: string, sourceFilePath: string): string[] {
		let sourceDir = path.dirname(sourceFilePath);
		let result: string[] = [];
		while (sourceDir.length >= repoRoot.length) {
			result.push(path.join(sourceDir, 'node_modules', module));
			sourceDir = path.dirname(sourceDir);
		}
		return result;
	}
}
