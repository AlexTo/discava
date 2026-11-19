/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  renderWithInstructorApi,
} from '../../../../../../test/render-with-instructor-api';
import { CoursePriceForm } from './course-price-form';

const COURSE_ID = 'course-1';

const renderForm = (
  priceAmount: number,
  priceCurrency = 'USD',
  handlers = {},
) =>
  renderWithInstructorApi(
    <CoursePriceForm
      courseId={COURSE_ID}
      priceAmount={priceAmount}
      priceCurrency={priceCurrency}
    />,
    { handlers },
  );

const priceField = () => screen.getByLabelText('Price');
const currencyField = () => screen.getByLabelText('Currency');
const save = () => screen.getByRole('button', { name: 'Save price' });

const typePrice = async (
  user: ReturnType<typeof renderForm>['user'],
  value: string,
) => {
  await user.clear(priceField());
  await user.type(priceField(), value);
};

describe('CoursePriceForm', () => {
  it('shows the current price and currency', () => {
    renderForm(1999, 'GBP');

    expect(priceField()).toHaveValue('19.99');
    expect(currencyField()).toHaveValue('GBP');
  });

  it('shows a free course as 0', () => {
    renderForm(0);

    expect(priceField()).toHaveValue('0');
  });

  it('says enrolled students keep their access', () => {
    renderForm(0);

    expect(
      screen.getByText(
        'Students who are already enrolled keep their access; the new price applies to new purchases.',
      ),
    ).toBeInTheDocument();
  });

  it('sends "19.99" as 1999 with the chosen currency', async () => {
    const { calls, user } = renderForm(0, 'USD', {
      'course.setPrice': () => ({}),
    });

    await typePrice(user, '19.99');
    await user.selectOptions(currencyField(), 'EUR');
    await user.click(save());

    await waitFor(() =>
      expect(calls).toEqual([
        {
          path: 'course.setPrice',
          input: {
            courseId: COURSE_ID,
            priceAmount: 1999,
            priceCurrency: 'EUR',
          },
        },
      ]),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
  });

  it('sends 0 as free', async () => {
    const { calls, user } = renderForm(1999, 'USD', {
      'course.setPrice': () => ({}),
    });

    await typePrice(user, '0');
    await user.click(save());

    await waitFor(() =>
      expect(calls).toEqual([
        {
          path: 'course.setPrice',
          input: { courseId: COURSE_ID, priceAmount: 0, priceCurrency: 'USD' },
        },
      ]),
    );
  });

  it.each(['abc', '0.5', '1.234', '-5'])(
    'shows the rule for "%s" and sends nothing',
    async (value) => {
      const { calls, user } = renderForm(0);

      await typePrice(user, value);
      await user.click(save());

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'minimum 1.00, maximum 10,000.00',
      );
      expect(calls).toEqual([]);
    },
  );

  it('shows the rule for a price above the maximum and sends nothing', async () => {
    const { calls, user } = renderForm(0);

    await typePrice(user, '10001');
    await user.click(save());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'between 1.00 and 10,000.00',
    );
    expect(calls).toEqual([]);
  });

  it('shows the API message and restores the field when saving fails', async () => {
    const { user } = renderForm(1999, 'GBP', {
      'course.setPrice': () => {
        throw new ApiError(
          'PRECONDITION_FAILED',
          "Payments aren't set up yet; ask an administrator",
        );
      },
    });

    await typePrice(user, '25');
    await user.selectOptions(currencyField(), 'EUR');
    await user.click(save());

    expect(
      await screen.findByText("Couldn't save the price"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Payments aren't set up yet; ask an administrator"),
    ).toBeInTheDocument();
    expect(priceField()).toHaveValue('19.99');
    expect(currencyField()).toHaveValue('GBP');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
