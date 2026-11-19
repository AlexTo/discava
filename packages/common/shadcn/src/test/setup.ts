/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// DOM matchers such as toBeInTheDocument and toBeChecked.
import '@testing-library/jest-dom/vitest';

import { installJsdomStubs } from '@discava/common-web-utils/testing';

installJsdomStubs();
