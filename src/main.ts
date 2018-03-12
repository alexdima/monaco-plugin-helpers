/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { _getGitVersion } from './git';
import { IOptions, _packageESM } from './packageESM';

export function getGitVersion(repoRoot: string): string {
	return _getGitVersion(repoRoot);
}

export function packageESM(options: IOptions): void {
	return _packageESM(options);
}