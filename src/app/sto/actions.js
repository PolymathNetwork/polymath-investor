import React from 'react'
import BigNumber from 'bignumber.js'
import * as ui from 'polymath-ui'
import { reset } from 'redux-form'
import { PolyToken, SecurityTokenRegistry } from 'polymathjs'

import config from '../../config.json'
import { formName } from './PurchaseForm'
import type { ExtractReturn } from '../../redux/helpers'
import type { GetState } from '../../redux/reducer'

export const DATA = 'sto/DATA'
export const PURCHASE_MODAL_OPEN = 'sto/PURCHASE_MODAL_OPEN'

export const PURCHASE_MODAL_CLOSE = 'sto/PURCHASE_MODAL_CLOSE'
export const purchaseModalClose = () => (dispatch: Function) => {
  dispatch({ type: PURCHASE_MODAL_CLOSE })
  dispatch(reset(formName))
}

export const PAUSE_STATUS = 'sto/PAUSE_STATUS'
export const pauseStatus = (status: boolean) => ({ type: PAUSE_STATUS, status })

export type Action =
  | ExtractReturn<typeof pauseStatus>

export const fetch = (ticker?: string) => async (dispatch: Function) => {
  dispatch(ui.fetching())
  try {
    const token = await SecurityTokenRegistry.getTokenByTicker(config.ticker || ticker)
    let sto, details
    if (token) {
      sto = await token.contract.getSTO()
      if (sto) {
        details = await sto.getDetails()
        dispatch(pauseStatus(await sto.paused()))
        // noinspection JSIgnoredPromiseFromCall
        sto.subscribe('Pause', {}, () => {
          dispatch(pauseStatus(true))
        }) // noinspection JSIgnoredPromiseFromCall
        sto.subscribe('Unpause', {}, () => {
          dispatch(pauseStatus(false))
        })
      }
    }
    dispatch({ type: DATA, token, sto, details })
    dispatch(ui.fetched())
  } catch (e) {
    dispatch(ui.fetchingFailed(e))
  }
}

export const purchasePrep = () => async (dispatch: Function, getState: GetState) => {
  const { token } = getState().sto
  const { account } = getState().network
  const st = token.contract
  if (!(await st.verifyTransfer(0, account, 1))) {
    dispatch(ui.confirm(
      <div>
        You are not allowed to participate in {token.ticker} STO.
      </div>,
      () => {},
      'Purchase Error',
      'Understood',
      '',
      'Transaction Impossible'
    ))
    return
  }
  // TODO @bshevchenko: reset purchase form values
  dispatch({ type: PURCHASE_MODAL_OPEN })
}

export const purchase = () => async (dispatch: Function, getState: GetState) => {
  let { tokens } = getState().form[formName].values
  tokens = new BigNumber(tokens)
  dispatch(purchaseModalClose())

  let { token, sto, details } = getState().sto
  const { account } = getState().network
  const st = token.contract
  const value = (new BigNumber(tokens)).div(details.rate)

  let allowance
  let isSufficientAllowance
  if (details.isPolyFundraise) {
    allowance = await PolyToken.allowance(account, sto.address)
    isSufficientAllowance = allowance.gte(value)
  }

  dispatch(ui.confirm(
    <div>
      {details.isPolyFundraise ? (
        <span>
          {isSufficientAllowance ?
            'You approved POLY spend earlier, so now you will have to sign only one transaction.' :
            `Completion of your purchase of ${token.ticker} Token requires two wallet transactions.`}
        </span>
      ) : ''}
    </div>,
    async () => {
      if (!(await st.verifyTransfer(0, account, tokens))) {
        dispatch(ui.confirm(
          <div>
            You are not allowed to receive {ui.thousandsDelimiter(tokens)} {token.ticker}.<br />
            Try lower value.
          </div>,
          () => {},
          'Purchase Error',
          'Understood',
          '',
          'Transaction Impossible'
        ))
        return
      }
      details = await sto.getDetails()
      if (!details.tokensSold.add(tokens).lte(details.cap)) {
        dispatch(ui.confirm(
          <div>
            The maximum number of tokens that you can now purchase
            is <strong>{ui.thousandsDelimiter(details.cap.minus(details.tokensSold))}</strong>.
          </div>,
          () => {},
          'Purchase Error',
          'Understood',
          '',
          'Transaction Impossible'
        ))
        return
      }
      dispatch(ui.tx(
        [...(details.isPolyFundraise && !isSufficientAllowance ? ['Approving POLY Spend'] : []), 'Token Purchase'],
        async () => {
          await sto.buy(value)
        },
        `Congratulations! You Completed Your Purchase of ${ui.thousandsDelimiter(tokens)} of ${token.ticker} Tokens`,
        () => {
          dispatch(fetch(token.ticker))
        },
        undefined,
        undefined,
        true
      ))
    },
    `Proceeding with Your Purchase of ${token.ticker} Tokens`,
  ))
}
