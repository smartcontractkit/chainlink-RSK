pragma solidity ^0.5.0;

import "./ChainlinkClient.sol";

contract Consumer is ChainlinkClient {
  bytes32 internal specId;
  bytes32 public currentPrice;

  event RequestFulfilled(
    bytes32 indexed requestId,  // User-defined ID
    bytes32 indexed price
  );
  
  constructor(address _link, address _oracle, bytes32 _specId) public {
    setChainlinkToken(_link);
    setChainlinkOracle(_oracle);
    specId = _specId;
  }

  function requestRIFPrice(uint256 _payment) public {
    requestRIFPriceByCallback(_payment, address(this));
  }

  function requestRIFPriceByCallback(uint256 _payment, address _callback) public {
    Chainlink.Request memory req = buildChainlinkRequest(specId, _callback, this.fulfill.selector);
    req.add("get", "https://api.liquid.com/products/580");
    req.add("path", "last_traded_price");
    req.addInt("times", 100000000);
    sendChainlinkRequest(req, _payment);
  }

  function cancelRequest(
    address _oracle,
    bytes32 _requestId,
    uint256 _payment,
    bytes4 _callbackFunctionId,
    uint256 _expiration
  ) public {
    ChainlinkRequestInterface requested = ChainlinkRequestInterface(_oracle);
    requested.cancelOracleRequest(_requestId, _payment, _callbackFunctionId, _expiration);
  }

  function withdrawLink() public {
    LinkTokenInterface _link = LinkTokenInterface(chainlinkTokenAddress());
    require(_link.transfer(msg.sender, _link.balanceOf(address(this))), "Unable to transfer");
  }

  function addExternalRequest(address _oracle, bytes32 _requestId) external {
    addChainlinkExternalRequest(_oracle, _requestId);
  }

  function fulfill(bytes32 _requestId, bytes32 _price)
    public
    recordChainlinkFulfillment(_requestId)
  {
    emit RequestFulfilled(_requestId, _price);
    currentPrice = _price;
  }

}
