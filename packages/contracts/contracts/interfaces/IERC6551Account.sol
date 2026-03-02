// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IERC6551Account
 * @notice Interface that every Token Bound Account must implement (EIP-6551).
 *
 * Allows callers to identify the NFT that owns this account and
 * verify whether a given address is a valid signer for it.
 */
interface IERC6551Account {
    /**
     * @notice Receive ETH sent to this account.
     */
    receive() external payable;

    /**
     * @notice Returns the NFT that owns this account.
     * @return chainId The chain the NFT lives on
     * @return tokenContract The ERC-721 contract address
     * @return tokenId The token ID
     */
    function token()
        external
        view
        returns (uint256 chainId, address tokenContract, uint256 tokenId);

    /**
     * @notice Returns the current state nonce (incremented on each execution).
     */
    function state() external view returns (uint256);

    /**
     * @notice Check if `signer` is authorized to act on behalf of this TBA.
     * @return magicValue 0x523e3260 if valid, 0x00000000 otherwise
     */
    function isValidSigner(address signer, bytes calldata context)
        external
        view
        returns (bytes4 magicValue);
}

/**
 * @title IERC6551Executable
 * @notice Execution interface for TBAs — allows the NFT owner to make
 *         arbitrary calls from the TBA wallet.
 */
interface IERC6551Executable {
    /**
     * @notice Execute a call from this TBA.
     * @param to Target contract address
     * @param value ETH value to send
     * @param data Calldata to forward
     * @param operationType 0 = CALL, 1 = DELEGATECALL, 2 = CREATE, 3 = CREATE2
     * @return result The return data from the call
     */
    function execute(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operationType
    ) external payable returns (bytes memory result);
}
