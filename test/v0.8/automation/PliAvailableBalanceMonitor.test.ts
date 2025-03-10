import { ethers } from 'hardhat'
import chai, { assert, expect } from 'chai'
import type { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import * as h from '../../test-helpers/helpers'
import { mineBlock } from '../../test-helpers/helpers'
import { IAggregatorProxy__factory as IAggregatorProxyFactory } from '../../../typechain/factories/IAggregatorProxy__factory'
import { IPliAvailable__factory as IPliAvailableFactory } from '../../../typechain/factories/IPliAvailable__factory'
import { PliAvailableBalanceMonitor, PliToken } from '../../../typechain'
import { BigNumber } from 'ethers'
import deepEqualInAnyOrder from 'deep-equal-in-any-order'
import {
  deployMockContract,
  MockContract,
} from '@ethereum-waffle/mock-contract'

chai.use(deepEqualInAnyOrder)

//////////////////////////////// GAS USAGE LIMITS - CHANGE WITH CAUTION //////////////////////////
//                                                                                              //
// we try to keep gas usage under this amount (max is 5M)                                       //
const TARGET_PERFORM_GAS_LIMIT = 2_000_000
// we try to keep gas usage under this amount (max is 5M) the test is not a perfectly accurate  //
// measurement of gas usage because it relies on mocks which may do fewer storage reads         //
// therefore, we keep a healthy margin to avoid running over the limit!                         //
const TARGET_CHECK_GAS_LIMIT = 3_500_000
//                                                                                              //
//////////////////////////////////////////////////////////////////////////////////////////////////
const INVALID_WATCHLIST_ERR = `InvalidWatchList`
const PAUSED_ERR = 'Pausable: paused'

const zeroPLI = ethers.utils.parseEther('0')
const onePLI = ethers.utils.parseEther('1')
const twoPLI = ethers.utils.parseEther('2')
const fourPLI = ethers.utils.parseEther('4')
const tenPLI = ethers.utils.parseEther('10')
const oneHundredPLI = ethers.utils.parseEther('100')

const randAddr = () => ethers.Wallet.createRandom().address

let labm: PliAvailableBalanceMonitor
let lt: PliToken
let owner: SignerWithAddress
let stranger: SignerWithAddress
let keeperRegistry: SignerWithAddress
let proxy1: MockContract
let proxy2: MockContract
let proxy3: MockContract
let proxy4: MockContract // leave this proxy / aggregator unconfigured for topUp() testing
let aggregator1: MockContract
let aggregator2: MockContract
let aggregator3: MockContract
let aggregator4: MockContract // leave this proxy / aggregator unconfigured for topUp() testing

let directTarget1: MockContract // Contracts which are direct target of balance monitoring without proxy
let directTarget2: MockContract

let watchListAddresses: string[]
let watchListMinBalances: BigNumber[]
let watchListTopUpAmounts: BigNumber[]
let watchListDstChainSelectors: number[]

async function assertContractPliBalances(
  balance1: BigNumber,
  balance2: BigNumber,
  balance3: BigNumber,
  balance4: BigNumber,
  balance5: BigNumber,
) {
  await h.assertPliTokenBalance(lt, aggregator1.address, balance1, 'address 1')
  await h.assertPliTokenBalance(lt, aggregator2.address, balance2, 'address 2')
  await h.assertPliTokenBalance(lt, aggregator3.address, balance3, 'address 3')
  await h.assertPliTokenBalance(
    lt,
    directTarget1.address,
    balance4,
    'address 4',
  )
  await h.assertPliTokenBalance(
    lt,
    directTarget2.address,
    balance5,
    'address 5',
  )
}

const setup = async () => {
  const accounts = await ethers.getSigners()
  owner = accounts[0]
  stranger = accounts[1]
  keeperRegistry = accounts[2]

  proxy1 = await deployMockContract(owner, IAggregatorProxyFactory.abi)
  proxy2 = await deployMockContract(owner, IAggregatorProxyFactory.abi)
  proxy3 = await deployMockContract(owner, IAggregatorProxyFactory.abi)
  proxy4 = await deployMockContract(owner, IAggregatorProxyFactory.abi)
  aggregator1 = await deployMockContract(owner, IPliAvailableFactory.abi)
  aggregator2 = await deployMockContract(owner, IPliAvailableFactory.abi)
  aggregator3 = await deployMockContract(owner, IPliAvailableFactory.abi)
  aggregator4 = await deployMockContract(owner, IPliAvailableFactory.abi)
  directTarget1 = await deployMockContract(owner, IPliAvailableFactory.abi)
  directTarget2 = await deployMockContract(owner, IPliAvailableFactory.abi)

  await proxy1.deployed()
  await proxy2.deployed()
  await proxy3.deployed()
  await proxy4.deployed()
  await aggregator1.deployed()
  await aggregator2.deployed()
  await aggregator3.deployed()
  await aggregator4.deployed()
  await directTarget1.deployed()
  await directTarget2.deployed()

  watchListAddresses = [
    proxy1.address,
    proxy2.address,
    proxy3.address,
    directTarget1.address,
    directTarget2.address,
  ]
  watchListMinBalances = [onePLI, onePLI, onePLI, twoPLI, twoPLI]
  watchListTopUpAmounts = [twoPLI, twoPLI, twoPLI, twoPLI, twoPLI]
  watchListDstChainSelectors = [1, 2, 3, 4, 5]

  await proxy1.mock.aggregator.returns(aggregator1.address)
  await proxy2.mock.aggregator.returns(aggregator2.address)
  await proxy3.mock.aggregator.returns(aggregator3.address)

  await aggregator1.mock.pliAvailableForPayment.returns(0)
  await aggregator2.mock.pliAvailableForPayment.returns(0)
  await aggregator3.mock.pliAvailableForPayment.returns(0)

  await directTarget1.mock.pliAvailableForPayment.returns(0)
  await directTarget2.mock.pliAvailableForPayment.returns(0)

  const labmFactory = await ethers.getContractFactory(
    'PliAvailableBalanceMonitor',
    owner,
  )
  const ltFactory = await ethers.getContractFactory(
    'src/v0.8/shared/test/helpers/PliTokenTestHelper.sol:PliTokenTestHelper',
    owner,
  )

  // New parameters needed by the constructor
  const maxPerform = 5
  const maxCheck = 20
  const minWaitPeriodSeconds = 0
  const upkeepInterval = 10

  lt = (await ltFactory.deploy()) as PliToken
  labm = await labmFactory.deploy(
    owner.address,
    lt.address,
    minWaitPeriodSeconds,
    maxPerform,
    maxCheck,
    upkeepInterval,
  )
  await labm.deployed()

  for (let i = 1; i <= 4; i++) {
    const recipient = await accounts[i].getAddress()
    await lt.connect(owner).transfer(recipient, oneHundredPLI)
  }

  const setTx = await labm
    .connect(owner)
    .setWatchList(
      watchListAddresses,
      watchListMinBalances,
      watchListTopUpAmounts,
      watchListDstChainSelectors,
    )
  await setTx.wait()
}

describe('PliAvailableBalanceMonitor', () => {
  beforeEach(async () => {
    await loadFixture(setup)
  })

  describe('add funds', () => {
    it('should allow anyone to add funds', async () => {
      await lt.transfer(labm.address, onePLI)
      await lt.connect(stranger).transfer(labm.address, onePLI)
    })
  })

  describe('setTopUpAmount()', () => {
    it('configures the top-up amount', async () => {
      await labm
        .connect(owner)
        .setTopUpAmount(directTarget1.address, BigNumber.from(100))
      const report = await labm.getAccountInfo(directTarget1.address)
      assert.equal(report.topUpAmount.toString(), '100')
    })

    it('is only callable by the owner', async () => {
      await expect(
        labm.connect(stranger).setTopUpAmount(directTarget1.address, 100),
      ).to.be.reverted
    })
  })

  describe('setMinBalance()', () => {
    it('configures the min balance', async () => {
      await labm
        .connect(owner)
        .setMinBalance(proxy1.address, BigNumber.from(100))
      const report = await labm.getAccountInfo(proxy1.address)
      assert.equal(report.minBalance.toString(), '100')
    })

    it('reverts if address is not in the watchlist', async () => {
      await expect(labm.connect(owner).setMinBalance(proxy4.address, 100)).to.be
        .reverted
    })

    it('is only callable by the owner', async () => {
      await expect(labm.connect(stranger).setMinBalance(proxy1.address, 100)).to
        .be.reverted
    })
  })

  describe('setMaxPerform()', () => {
    it('configures the MaxPerform', async () => {
      await labm.connect(owner).setMaxPerform(BigNumber.from(100))
      const report = await labm.getMaxPerform()
      assert.equal(report.toString(), '100')
    })

    it('is only callable by the owner', async () => {
      await expect(labm.connect(stranger).setMaxPerform(100)).to.be.reverted
    })
  })

  describe('setMaxCheck()', () => {
    it('configures the MaxCheck', async () => {
      await labm.connect(owner).setMaxCheck(BigNumber.from(100))
      const report = await labm.getMaxCheck()
      assert.equal(report.toString(), '100')
    })

    it('is only callable by the owner', async () => {
      await expect(labm.connect(stranger).setMaxCheck(100)).to.be.reverted
    })
  })

  describe('setUpkeepInterval()', () => {
    it('configures the UpkeepInterval', async () => {
      await labm.connect(owner).setUpkeepInterval(BigNumber.from(100))
      const report = await labm.getUpkeepInterval()
      assert.equal(report.toString(), '100')
    })

    it('is only callable by the owner', async () => {
      await expect(labm.connect(stranger).setUpkeepInterval(100)).to.be.reverted
    })
  })

  describe('withdraw()', () => {
    beforeEach(async () => {
      const tx = await lt.connect(owner).transfer(labm.address, onePLI)
      await tx.wait()
    })

    it('should allow the owner to withdraw', async () => {
      const beforeBalance = await lt.balanceOf(owner.address)
      const tx = await labm.connect(owner).withdraw(onePLI, owner.address)
      await tx.wait()
      const afterBalance = await lt.balanceOf(owner.address)
      assert.isTrue(
        afterBalance.gt(beforeBalance),
        'balance did not increase after withdraw',
      )
    })

    it('should emit an event', async () => {
      const tx = await labm.connect(owner).withdraw(onePLI, owner.address)
      await expect(tx)
        .to.emit(labm, 'FundsWithdrawn')
        .withArgs(onePLI, owner.address)
    })

    it('should allow the owner to withdraw to anyone', async () => {
      const beforeBalance = await lt.balanceOf(stranger.address)
      const tx = await labm.connect(owner).withdraw(onePLI, stranger.address)
      await tx.wait()
      const afterBalance = await lt.balanceOf(stranger.address)
      assert.isTrue(
        beforeBalance.add(onePLI).eq(afterBalance),
        'balance did not increase after withdraw',
      )
    })

    it('should not allow strangers to withdraw', async () => {
      const tx = labm.connect(stranger).withdraw(onePLI, owner.address)
      await expect(tx).to.be.reverted
    })
  })

  describe('pause() / unpause()', () => {
    it('should allow owner to pause / unpause', async () => {
      const pauseTx = await labm.connect(owner).pause()
      await pauseTx.wait()
      const unpauseTx = await labm.connect(owner).unpause()
      await unpauseTx.wait()
    })

    it('should not allow strangers to pause / unpause', async () => {
      const pauseTxStranger = labm.connect(stranger).pause()
      await expect(pauseTxStranger).to.be.reverted
      const pauseTxOwner = await labm.connect(owner).pause()
      await pauseTxOwner.wait()
      const unpauseTxStranger = labm.connect(stranger).unpause()
      await expect(unpauseTxStranger).to.be.reverted
    })
  })

  describe('setWatchList() / addToWatchListOrDecommissionOrDecommission() / removeFromWatchlist() / getWatchList()', () => {
    const watchAddress1 = randAddr()
    const watchAddress2 = randAddr()
    const watchAddress3 = randAddr()

    beforeEach(async () => {
      // reset watchlist to empty before running these tests
      await labm.connect(owner).setWatchList([], [], [], [])
      const watchList = await labm.getWatchList()
      assert.deepEqual(watchList, [])
    })

    it('should allow owner to adjust the watchlist', async () => {
      // add first watchlist
      await labm
        .connect(owner)
        .setWatchList([watchAddress1], [onePLI], [onePLI], [0])
      let watchList = await labm.getWatchList()
      assert.deepEqual(watchList[0], watchAddress1)
      // add more to watchlist
      const tx = await labm
        .connect(owner)
        .setWatchList(
          [watchAddress1, watchAddress2, watchAddress3],
          [onePLI, onePLI, onePLI],
          [onePLI, onePLI, onePLI],
          [1, 2, 3],
        )
      await tx.wait()
      watchList = await labm.getWatchList()
      assert.deepEqual(watchList, [watchAddress1, watchAddress2, watchAddress3])
    })

    it('should not allow different length arrays in the watchlist', async () => {
      const tx = labm
        .connect(owner)
        .setWatchList(
          [watchAddress1, watchAddress2, watchAddress1],
          [onePLI, onePLI],
          [onePLI, onePLI],
          [1, 2],
        )
      await expect(tx).to.be.revertedWithCustomError(
        labm,
        INVALID_WATCHLIST_ERR,
      )
    })

    it('should not allow duplicates in the watchlist', async () => {
      const tx = labm
        .connect(owner)
        .setWatchList(
          [watchAddress1, watchAddress2, watchAddress1],
          [onePLI, onePLI, onePLI],
          [onePLI, onePLI, onePLI],
          [1, 2, 3],
        )
      await expect(tx)
        .to.be.revertedWithCustomError(labm, 'DuplicateAddress')
        .withArgs(watchAddress1)
    })

    it('should not allow strangers to set the watchlist', async () => {
      const setTxStranger = labm
        .connect(stranger)
        .setWatchList([watchAddress1], [onePLI], [onePLI], [0])
      await expect(setTxStranger).to.be.reverted
    })

    it('should revert if any of the addresses are empty', async () => {
      const tx = labm
        .connect(owner)
        .setWatchList(
          [watchAddress1, ethers.constants.AddressZero],
          [onePLI, onePLI],
          [onePLI, onePLI],
          [1, 2],
        )
      await expect(tx).to.be.revertedWithCustomError(
        labm,
        INVALID_WATCHLIST_ERR,
      )
    })

    it('should allow owner to add multiple addresses with dstChainSelector 0 to the watchlist', async () => {
      let tx = await labm
        .connect(owner)
        .addToWatchListOrDecommission(watchAddress1, 0)
      await tx.wait
      let watchList = await labm.getWatchList()
      assert.deepEqual(watchList[0], watchAddress1)

      tx = await labm
        .connect(owner)
        .addToWatchListOrDecommission(watchAddress2, 0)
      await tx.wait
      watchList = await labm.getWatchList()
      assert.deepEqual(watchList[0], watchAddress1)
      assert.deepEqual(watchList[1], watchAddress2)

      tx = await labm
        .connect(owner)
        .addToWatchListOrDecommission(watchAddress3, 0)
      await tx.wait
      watchList = await labm.getWatchList()
      assert.deepEqual(watchList[0], watchAddress1)
      assert.deepEqual(watchList[1], watchAddress2)
      assert.deepEqual(watchList[2], watchAddress3)
    })

    it('should allow owner to add only one address with an unique non-zero dstChainSelector 0 to the watchlist', async () => {
      let tx = await labm
        .connect(owner)
        .addToWatchListOrDecommission(watchAddress1, 1)
      await tx.wait
      let watchList = await labm.getWatchList()
      assert.deepEqual(watchList[0], watchAddress1)

      // 1 is active
      let report = await labm.getAccountInfo(watchAddress1)
      assert.isTrue(report.isActive)

      tx = await labm
        .connect(owner)
        .addToWatchListOrDecommission(watchAddress2, 1)
      await tx.wait
      watchList = await labm.getWatchList()
      assert.deepEqual(watchList[0], watchAddress2)

      // 2 is active, 1 should be false
      report = await labm.getAccountInfo(watchAddress2)
      assert.isTrue(report.isActive)
      report = await labm.getAccountInfo(watchAddress1)
      assert.isFalse(report.isActive)

      tx = await labm
        .connect(owner)
        .addToWatchListOrDecommission(watchAddress3, 1)
      await tx.wait
      watchList = await labm.getWatchList()
      assert.deepEqual(watchList[0], watchAddress3)

      // 3 is active, 1 and 2 should be false
      report = await labm.getAccountInfo(watchAddress3)
      assert.isTrue(report.isActive)
      report = await labm.getAccountInfo(watchAddress2)
      assert.isFalse(report.isActive)
      report = await labm.getAccountInfo(watchAddress1)
      assert.isFalse(report.isActive)
    })

    it('should not add address 0 to the watchlist', async () => {
      await labm
        .connect(owner)
        .addToWatchListOrDecommission(ethers.constants.AddressZero, 1)
      expect(await labm.getWatchList()).to.not.contain(
        ethers.constants.AddressZero,
      )
    })

    it('should not allow stangers to add addresses to the watchlist', async () => {
      await expect(
        labm.connect(stranger).addToWatchListOrDecommission(watchAddress1, 1),
      ).to.be.reverted
    })

    it('should allow owner to remove addresses from the watchlist', async () => {
      const tx = await labm
        .connect(owner)
        .addToWatchListOrDecommission(watchAddress1, 1)
      await tx.wait
      let watchList = await labm.getWatchList()
      assert.deepEqual(watchList[0], watchAddress1)
      let report = await labm.getAccountInfo(watchAddress1)
      assert.isTrue(report.isActive)

      // remove address
      await labm.connect(owner).removeFromWatchList(watchAddress1)

      // address should be false
      report = await labm.getAccountInfo(watchAddress1)
      assert.isFalse(report.isActive)

      watchList = await labm.getWatchList()
      assert.deepEqual(watchList, [])
    })

    it('should allow only one address per dstChainSelector', async () => {
      // add address1
      await labm.connect(owner).addToWatchListOrDecommission(watchAddress1, 1)
      expect(await labm.getWatchList()).to.contain(watchAddress1)

      // add address2
      await labm.connect(owner).addToWatchListOrDecommission(watchAddress2, 1)

      // only address2 has to be in the watchlist
      const watchlist = await labm.getWatchList()
      expect(watchlist).to.not.contain(watchAddress1)
      expect(watchlist).to.contain(watchAddress2)
    })

    it('should delete the onRamp address on a zero-address with same dstChainSelector', async () => {
      // add address1
      await labm.connect(owner).addToWatchListOrDecommission(watchAddress1, 1)
      expect(await labm.getWatchList()).to.contain(watchAddress1)

      // simulates an onRampSet(zeroAddress, same dstChainSelector)
      await labm
        .connect(owner)
        .addToWatchListOrDecommission(ethers.constants.AddressZero, 1)

      // address1 should be cleaned
      const watchlist = await labm.getWatchList()
      expect(watchlist).to.not.contain(watchAddress1)
      assert.deepEqual(watchlist, [])
    })
  })

  describe('checkUpkeep() / sampleUnderfundedAddresses() [ @skip-coverage ]', () => {
    it('should return list of address that are underfunded', async () => {
      const fundTx = await lt
        .connect(owner)
        .transfer(labm.address, oneHundredPLI)
      await fundTx.wait()

      await labm.setWatchList(
        watchListAddresses,
        watchListMinBalances,
        watchListTopUpAmounts,
        watchListDstChainSelectors,
      )

      const [should, payload] = await labm.checkUpkeep('0x')
      assert.isTrue(should)
      let [addresses] = ethers.utils.defaultAbiCoder.decode(
        ['address[]'],
        payload,
      )

      expect(addresses).to.deep.equalInAnyOrder(watchListAddresses)
      addresses = await labm.sampleUnderfundedAddresses()
      expect(addresses).to.deep.equalInAnyOrder(watchListAddresses)
    })

    it('should return false because the monitor is underfunded', async () => {
      // it needs 10 PLIs to fund all 5 upkeeps, but it only has 8 PLIs
      const fundTx = await lt
        .connect(owner)
        .transfer(labm.address, fourPLI.add(fourPLI))
      await fundTx.wait()

      await labm.setWatchList(
        watchListAddresses,
        watchListMinBalances,
        watchListTopUpAmounts,
        watchListDstChainSelectors,
      )

      const [should, _] = await labm.checkUpkeep('0x')
      assert.isFalse(should)
    })

    it('should omit aggregators that have sufficient funding', async () => {
      const fundTx = await lt.connect(owner).transfer(
        labm.address,
        oneHundredPLI, // enough for anything that needs funding
      )
      await fundTx.wait()

      await labm.setWatchList(
        [aggregator2.address, directTarget1.address, directTarget2.address],
        [onePLI, twoPLI, twoPLI],
        [onePLI, onePLI, onePLI],
        [1, 2, 3],
      )

      // all of them are underfunded, return 3
      await aggregator2.mock.pliAvailableForPayment.returns(zeroPLI)
      await directTarget1.mock.pliAvailableForPayment.returns(zeroPLI)
      await directTarget2.mock.pliAvailableForPayment.returns(zeroPLI)

      let addresses = await labm.sampleUnderfundedAddresses()
      expect(addresses).to.deep.equalInAnyOrder([
        aggregator2.address,
        directTarget1.address,
        directTarget2.address,
      ])

      await aggregator2.mock.pliAvailableForPayment.returns(onePLI) // aggregator2 is enough funded
      await directTarget1.mock.pliAvailableForPayment.returns(onePLI) // directTarget1 is NOT enough funded
      await directTarget2.mock.pliAvailableForPayment.returns(onePLI) // directTarget2 is NOT funded
      addresses = await labm.sampleUnderfundedAddresses()
      expect(addresses).to.deep.equalInAnyOrder([
        directTarget1.address,
        directTarget2.address,
      ])

      await directTarget1.mock.pliAvailableForPayment.returns(tenPLI)
      addresses = await labm.sampleUnderfundedAddresses()
      expect(addresses).to.deep.equalInAnyOrder([directTarget2.address])

      await directTarget2.mock.pliAvailableForPayment.returns(tenPLI)
      addresses = await labm.sampleUnderfundedAddresses()
      expect(addresses).to.deep.equalInAnyOrder([])
    })

    it('should revert when paused', async () => {
      const tx = await labm.connect(owner).pause()
      await tx.wait()
      const ethCall = labm.checkUpkeep('0x')
      await expect(ethCall).to.be.revertedWith(PAUSED_ERR)
    })

    context('with a large set of proxies', async () => {
      // in this test, we cheat a little bit and point each proxy to the same aggregator,
      // which helps cut down on test time
      let MAX_PERFORM: number
      let MAX_CHECK: number
      let proxyAddresses: string[]
      let minBalances: BigNumber[]
      let topUpAmount: BigNumber[]
      let aggregators: MockContract[]
      let dstChainSelectors: number[]

      beforeEach(async () => {
        MAX_PERFORM = await labm.getMaxPerform()
        MAX_CHECK = await labm.getMaxCheck()
        proxyAddresses = []
        minBalances = []
        topUpAmount = []
        aggregators = []
        dstChainSelectors = []
        const numAggregators = MAX_CHECK + 50
        for (let idx = 0; idx < numAggregators; idx++) {
          const proxy = await deployMockContract(
            owner,
            IAggregatorProxyFactory.abi,
          )
          const aggregator = await deployMockContract(
            owner,
            IPliAvailableFactory.abi,
          )
          await proxy.mock.aggregator.returns(aggregator.address)
          await aggregator.mock.pliAvailableForPayment.returns(0)
          proxyAddresses.push(proxy.address)
          minBalances.push(onePLI)
          topUpAmount.push(onePLI)
          aggregators.push(aggregator)
          dstChainSelectors.push(0)
        }
        await labm.setWatchList(
          proxyAddresses,
          minBalances,
          topUpAmount,
          dstChainSelectors,
        )
        const watchlist = await labm.getWatchList()
        expect(watchlist).to.deep.equalInAnyOrder(proxyAddresses)
        assert.equal(watchlist.length, minBalances.length)
      })

      it('should not include more than MAX_PERFORM addresses', async () => {
        const addresses = await labm.sampleUnderfundedAddresses()
        expect(addresses.length).to.be.lessThanOrEqual(MAX_PERFORM)
      })

      it('should sample from the list of addresses pseudorandomly', async () => {
        const firstAddress: string[] = []
        for (let idx = 0; idx < 10; idx++) {
          const addresses = await labm.sampleUnderfundedAddresses()
          assert.equal(addresses.length, MAX_PERFORM)
          assert.equal(
            new Set(addresses).size,
            MAX_PERFORM,
            'duplicate address found',
          )
          firstAddress.push(addresses[0])
          await mineBlock(ethers.provider)
        }
        assert(
          new Set(firstAddress).size > 1,
          'sample did not shuffle starting index',
        )
      })

      it('can check MAX_CHECK upkeeps within the allotted gas limit', async () => {
        for (const aggregator of aggregators) {
          // here we make no aggregators eligible for funding, requiring the function to
          // traverse the whole list
          await aggregator.mock.pliAvailableForPayment.returns(tenPLI)
        }
        await labm.checkUpkeep('0x', { gasLimit: TARGET_CHECK_GAS_LIMIT })
      })
    })
  })

  describe('performUpkeep()', () => {
    let validPayload: string

    beforeEach(async () => {
      validPayload = ethers.utils.defaultAbiCoder.encode(
        ['address[]'],
        [watchListAddresses],
      )
      await labm
        .connect(owner)
        .setWatchList(
          watchListAddresses,
          watchListMinBalances,
          watchListTopUpAmounts,
          watchListDstChainSelectors,
        )
    })

    it('should revert when paused', async () => {
      await labm.connect(owner).pause()
      const performTx = labm.connect(keeperRegistry).performUpkeep(validPayload)
      await expect(performTx).to.be.revertedWith(PAUSED_ERR)
    })

    it('should fund the appropriate addresses', async () => {
      await aggregator1.mock.pliAvailableForPayment.returns(zeroPLI)
      await aggregator2.mock.pliAvailableForPayment.returns(zeroPLI)
      await aggregator3.mock.pliAvailableForPayment.returns(zeroPLI)
      await directTarget1.mock.pliAvailableForPayment.returns(zeroPLI)
      await directTarget2.mock.pliAvailableForPayment.returns(zeroPLI)

      const fundTx = await lt.connect(owner).transfer(labm.address, tenPLI)
      await fundTx.wait()

      await h.assertPliTokenBalance(lt, aggregator1.address, zeroPLI)
      await h.assertPliTokenBalance(lt, aggregator2.address, zeroPLI)
      await h.assertPliTokenBalance(lt, aggregator3.address, zeroPLI)
      await h.assertPliTokenBalance(lt, directTarget1.address, zeroPLI)
      await h.assertPliTokenBalance(lt, directTarget2.address, zeroPLI)

      const performTx = await labm
        .connect(keeperRegistry)
        .performUpkeep(validPayload, { gasLimit: 1_500_000 })
      await performTx.wait()

      await h.assertPliTokenBalance(lt, aggregator1.address, twoPLI)
      await h.assertPliTokenBalance(lt, aggregator2.address, twoPLI)
      await h.assertPliTokenBalance(lt, aggregator3.address, twoPLI)
      await h.assertPliTokenBalance(lt, directTarget1.address, twoPLI)
      await h.assertPliTokenBalance(lt, directTarget2.address, twoPLI)
    })

    it('can handle MAX_PERFORM proxies within gas limit', async () => {
      const MAX_PERFORM = await labm.getMaxPerform()
      const proxyAddresses = []
      const minBalances = []
      const topUpAmount = []
      const dstChainSelectors = []
      for (let idx = 0; idx < MAX_PERFORM; idx++) {
        const proxy = await deployMockContract(
          owner,
          IAggregatorProxyFactory.abi,
        )
        const aggregator = await deployMockContract(
          owner,
          IPliAvailableFactory.abi,
        )
        await proxy.mock.aggregator.returns(aggregator.address)
        await aggregator.mock.pliAvailableForPayment.returns(0)
        proxyAddresses.push(proxy.address)
        minBalances.push(onePLI)
        topUpAmount.push(onePLI)
        dstChainSelectors.push(0)
      }
      await labm.setWatchList(
        proxyAddresses,
        minBalances,
        topUpAmount,
        dstChainSelectors,
      )
      const watchlist = await labm.getWatchList()
      expect(watchlist).to.deep.equalInAnyOrder(proxyAddresses)
      assert.equal(watchlist.length, minBalances.length)

      // add funds
      const wl = await labm.getWatchList()
      const fundsNeeded = BigNumber.from(0)
      for (let idx = 0; idx < wl.length; idx++) {
        const targetInfo = await labm.getAccountInfo(wl[idx])
        const targetTopUpAmount = targetInfo.topUpAmount
        fundsNeeded.add(targetTopUpAmount)
      }
      await lt.connect(owner).transfer(labm.address, fundsNeeded)

      // encode payload
      const payload = ethers.utils.defaultAbiCoder.encode(
        ['address[]'],
        [proxyAddresses],
      )

      // do the thing
      await labm
        .connect(keeperRegistry)
        .performUpkeep(payload, { gasLimit: TARGET_PERFORM_GAS_LIMIT })
    })
  })

  describe('topUp()', () => {
    it('should revert topUp address(0)', async () => {
      const tx = await labm.connect(owner).topUp([ethers.constants.AddressZero])
      await expect(tx).to.emit(labm, 'TopUpBlocked')
    })

    context('when not paused', () => {
      it('should be callable by anyone', async () => {
        const users = [owner, keeperRegistry, stranger]
        for (let idx = 0; idx < users.length; idx++) {
          const user = users[idx]
          await labm.connect(user).topUp([])
        }
      })
    })

    context('when paused', () => {
      it('should be callable by no one', async () => {
        await labm.connect(owner).pause()
        const users = [owner, keeperRegistry, stranger]
        for (let idx = 0; idx < users.length; idx++) {
          const user = users[idx]
          const tx = labm.connect(user).topUp([])
          await expect(tx).to.be.revertedWith(PAUSED_ERR)
        }
      })
    })

    context('when fully funded', () => {
      beforeEach(async () => {
        await lt.connect(owner).transfer(labm.address, tenPLI)
        await assertContractPliBalances(
          zeroPLI,
          zeroPLI,
          zeroPLI,
          zeroPLI,
          zeroPLI,
        )
      })

      it('should fund the appropriate addresses', async () => {
        const ai1 = await labm.getAccountInfo(proxy1.address)
        assert.equal(0, ai1.lastTopUpTimestamp.toNumber())
        const ai4 = await labm.getAccountInfo(directTarget1.address)
        assert.equal(0, ai4.lastTopUpTimestamp.toNumber())

        const tx = await labm.connect(keeperRegistry).topUp(watchListAddresses)

        await aggregator1.mock.pliAvailableForPayment.returns(twoPLI)
        await aggregator2.mock.pliAvailableForPayment.returns(twoPLI)
        await aggregator3.mock.pliAvailableForPayment.returns(twoPLI)
        await directTarget1.mock.pliAvailableForPayment.returns(twoPLI)
        await directTarget2.mock.pliAvailableForPayment.returns(twoPLI)

        await expect(tx)
          .to.emit(labm, 'TopUpSucceeded')
          .withArgs(aggregator1.address, twoPLI)
        assert.equal(
          (await lt.balanceOf(aggregator1.address)).toBigInt(),
          twoPLI.toBigInt(),
        )
        const targetInfo1 = await labm.getAccountInfo(proxy1.address)
        assert.notEqual(0, targetInfo1.lastTopUpTimestamp.toNumber())
        await expect(tx)
          .to.emit(labm, 'TopUpSucceeded')
          .withArgs(aggregator2.address, twoPLI)
        await expect(tx)
          .to.emit(labm, 'TopUpSucceeded')
          .withArgs(aggregator3.address, twoPLI)
        await expect(tx)
          .to.emit(labm, 'TopUpSucceeded')
          .withArgs(directTarget1.address, twoPLI)
        assert.equal(
          (await lt.balanceOf(directTarget1.address)).toBigInt(),
          twoPLI.toBigInt(),
        )
        const targetInfo4 = await labm.getAccountInfo(directTarget1.address)
        assert.notEqual(0, targetInfo4.lastTopUpTimestamp.toNumber())
        await expect(tx)
          .to.emit(labm, 'TopUpSucceeded')
          .withArgs(directTarget2.address, twoPLI)
      })

      it('should only fund the addresses provided', async () => {
        await labm
          .connect(keeperRegistry)
          .topUp([proxy1.address, directTarget1.address])

        await aggregator1.mock.pliAvailableForPayment.returns(twoPLI)
        await aggregator2.mock.pliAvailableForPayment.returns(zeroPLI)
        await aggregator3.mock.pliAvailableForPayment.returns(zeroPLI)
        await directTarget1.mock.pliAvailableForPayment.returns(twoPLI)
        await directTarget2.mock.pliAvailableForPayment.returns(zeroPLI)
      })

      it('should skip un-approved addresses', async () => {
        await labm
          .connect(owner)
          .setWatchList(
            [proxy1.address, directTarget1.address],
            [onePLI, onePLI],
            [onePLI, onePLI],
            [1, 2],
          )
        const tx = await labm
          .connect(keeperRegistry)
          .topUp([
            proxy1.address,
            proxy2.address,
            proxy3.address,
            directTarget1.address,
            directTarget2.address,
          ])

        await h.assertPliTokenBalance(lt, aggregator1.address, onePLI)
        await h.assertPliTokenBalance(lt, aggregator2.address, zeroPLI)
        await h.assertPliTokenBalance(lt, aggregator3.address, zeroPLI)
        await h.assertPliTokenBalance(lt, directTarget1.address, onePLI)
        await h.assertPliTokenBalance(lt, directTarget2.address, zeroPLI)

        await expect(tx)
          .to.emit(labm, 'TopUpSucceeded')
          .withArgs(aggregator1.address, onePLI)
        const targetInfo1 = await labm.getAccountInfo(proxy1.address)
        assert.notEqual(0, targetInfo1.lastTopUpTimestamp.toNumber())

        await expect(tx)
          .to.emit(labm, 'TopUpSucceeded')
          .withArgs(directTarget1.address, onePLI)
        await expect(tx).to.emit(labm, 'TopUpBlocked').withArgs(proxy2.address)
        await expect(tx).to.emit(labm, 'TopUpBlocked').withArgs(proxy3.address)
        await expect(tx)
          .to.emit(labm, 'TopUpBlocked')
          .withArgs(directTarget2.address)
        const targetInfo5 = await labm.getAccountInfo(directTarget2.address)
        assert.equal(0, targetInfo5.lastTopUpTimestamp.toNumber())
      })

      it('should skip an address if the proxy is invalid and it is not a direct target', async () => {
        await labm
          .connect(owner)
          .setWatchList(
            [proxy1.address, proxy4.address],
            [onePLI, onePLI],
            [onePLI, onePLI],
            [1, 2],
          )
        const tx = await labm
          .connect(keeperRegistry)
          .topUp([proxy1.address, proxy4.address])
        await expect(tx)
          .to.emit(labm, 'TopUpSucceeded')
          .withArgs(aggregator1.address, onePLI)
        await expect(tx).to.emit(labm, 'TopUpBlocked').withArgs(proxy4.address)
      })

      it('should skip an address if the aggregator is invalid', async () => {
        await proxy4.mock.aggregator.returns(aggregator4.address)
        await labm
          .connect(owner)
          .setWatchList(
            [proxy1.address, proxy4.address],
            [onePLI, onePLI],
            [onePLI, onePLI],
            [1, 2],
          )
        const tx = await labm
          .connect(keeperRegistry)
          .topUp([proxy1.address, proxy4.address])
        await expect(tx)
          .to.emit(labm, 'TopUpSucceeded')
          .withArgs(aggregator1.address, onePLI)
        await expect(tx).to.emit(labm, 'TopUpBlocked').withArgs(proxy4.address)
      })

      it('should skip an address if the aggregator has sufficient funding', async () => {
        await proxy4.mock.aggregator.returns(aggregator4.address)
        await aggregator4.mock.pliAvailableForPayment.returns(tenPLI)
        await labm
          .connect(owner)
          .setWatchList(
            [proxy1.address, proxy4.address],
            [onePLI, onePLI],
            [onePLI, onePLI],
            [1, 2],
          )
        const tx = await labm
          .connect(keeperRegistry)
          .topUp([proxy1.address, proxy4.address])
        await expect(tx)
          .to.emit(labm, 'TopUpSucceeded')
          .withArgs(aggregator1.address, onePLI)
        await expect(tx).to.emit(labm, 'TopUpBlocked').withArgs(proxy4.address)
      })

      it('should skip an address if the direct target has sufficient funding', async () => {
        await directTarget1.mock.pliAvailableForPayment.returns(tenPLI)
        await labm
          .connect(owner)
          .setWatchList(
            [proxy1.address, directTarget1.address],
            [onePLI, onePLI],
            [onePLI, onePLI],
            [1, 2],
          )
        const tx = await labm
          .connect(keeperRegistry)
          .topUp([proxy1.address, directTarget1.address])
        await expect(tx)
          .to.emit(labm, 'TopUpSucceeded')
          .withArgs(aggregator1.address, onePLI)
        assert.equal(
          (await lt.balanceOf(aggregator1.address)).toBigInt(),
          onePLI.toBigInt(),
        )
        await expect(tx)
          .to.emit(labm, 'TopUpBlocked')
          .withArgs(directTarget1.address)
      })
    })

    context('when partially funded', () => {
      it('should fund as many addresses as possible', async () => {
        await lt.connect(owner).transfer(
          labm.address,
          fourPLI, // only enough PLI to fund 2 addresses
        )

        await aggregator1.mock.pliAvailableForPayment.returns(twoPLI)
        await aggregator2.mock.pliAvailableForPayment.returns(twoPLI)
        await aggregator3.mock.pliAvailableForPayment.returns(zeroPLI)
        await directTarget1.mock.pliAvailableForPayment.returns(zeroPLI)
        await directTarget2.mock.pliAvailableForPayment.returns(zeroPLI)

        const tx = await labm.connect(keeperRegistry).topUp(watchListAddresses)
        await expect(tx)
          .to.emit(labm, 'TopUpSucceeded')
          .withArgs(aggregator3.address, twoPLI)
        await expect(tx)
          .to.emit(labm, 'TopUpSucceeded')
          .withArgs(directTarget1.address, twoPLI)
        assert.equal(
          (await lt.balanceOf(aggregator3.address)).toBigInt(),
          twoPLI.toBigInt(),
        )
        assert.equal(
          (await lt.balanceOf(directTarget1.address)).toBigInt(),
          twoPLI.toBigInt(),
        )
      })
    })
  })
})
