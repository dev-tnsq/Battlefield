fn main(
    board: [Field; 100],
    expected_ship_cells: Field,
    salt: Field,
    commitments: [Field; 100]
) {
    let mut ship_cells = 0;

    for i in 0..100 {
        assert(board[i] == 0 || board[i] == 1);
        if board[i] == 1 {
            ship_cells = ship_cells + 1;
        }

        let index = i as Field + 1;
        assert(commitments[i] == board[i] + salt * index);
    }

    assert(ship_cells == expected_ship_cells);
}
