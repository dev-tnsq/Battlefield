fn main(
    board_cell: Field,
    x: Field,
    y: Field,
    salt: Field,
    commitment: Field,
    public_is_hit: Field
) {
    assert(board_cell == 0 || board_cell == 1);
    assert(public_is_hit == 0 || public_is_hit == 1);
    assert(board_cell == public_is_hit);

    assert(x < 10);
    assert(y < 10);

    let linear_index = y * 10 + x + 1;
    assert(commitment == board_cell + salt * linear_index);
}
