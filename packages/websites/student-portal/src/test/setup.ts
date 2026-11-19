/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// DOM matchers such as toBeInTheDocument and toHaveAccessibleName. Testing
// Library unmounts what each test rendered by itself, since `globals` is on.
import '@testing-library/jest-dom/vitest';

import { installJsdomStubs } from '@discava/common-web-utils/testing';

installJsdomStubs();
